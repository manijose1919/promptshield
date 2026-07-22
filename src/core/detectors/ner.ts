import type { AsyncDetector, EntityType, Match } from "../types.js";

/** A character span returned by an external NER service. */
interface NerSpan {
  start: number;
  end: number;
  label?: string;
  type?: string;
}

export interface HttpNerOptions {
  /** Endpoint that accepts `{ text }` and returns `{ spans: NerSpan[] }` (or a
   *  bare `NerSpan[]`). */
  url: string;
  /** Injectable fetch (tests / custom agents). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Entity type to tag every returned span with. Defaults to NAME. */
  entityType?: EntityType;
  /** Extra request headers (e.g. an auth token for the NER service). */
  headers?: Record<string, string>;
  /**
   * Behavior when the service errors or replies badly:
   * - `"empty"` (default): degrade to regex-only detection (fail open).
   * - `"throw"`: reject, so the request fails rather than under-redacting.
   */
  onError?: "empty" | "throw";
}

/**
 * Reference {@link AsyncDetector} backed by an HTTP NER service. This is the
 * concrete way to add open-vocabulary detection (bare person names, orgs,
 * locations) that the zero-dependency regex/heuristic detectors can't do —
 * without PromptShield taking on a model dependency. Wire it via
 * `new Redactor({ asyncDetectors: [createHttpNerDetector(...)] })` or
 * `createApp(config, { asyncDetectors: [...] })`.
 */
export function createHttpNerDetector(opts: HttpNerOptions): AsyncDetector {
  const type = opts.entityType ?? "NAME";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const onError = opts.onError ?? "empty";

  const fail = (err: unknown): Match[] => {
    if (onError === "throw") throw err instanceof Error ? err : new Error(String(err));
    return [];
  };

  return {
    type,
    async detectAsync(text: string): Promise<Match[]> {
      let res: Response;
      try {
        res = await fetchImpl(opts.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
          body: JSON.stringify({ text }),
        });
      } catch (err) {
        return fail(err);
      }
      if (!res.ok) return fail(new Error(`NER service responded ${res.status}`));

      let data: unknown;
      try {
        data = await res.json();
      } catch (err) {
        return fail(err);
      }

      const spans: NerSpan[] = Array.isArray(data)
        ? (data as NerSpan[])
        : ((data as { spans?: NerSpan[] })?.spans ?? []);

      const out: Match[] = [];
      for (const s of spans) {
        // Guard the offsets — a bad span must never produce an out-of-range
        // slice that could corrupt the left-to-right redaction pass.
        if (typeof s?.start !== "number" || typeof s?.end !== "number") continue;
        if (s.start < 0 || s.end > text.length || s.end <= s.start) continue;
        out.push({ type, start: s.start, end: s.end, value: text.slice(s.start, s.end) });
      }
      return out;
    },
  };
}
