import type {
  Action,
  Detector,
  EntityType,
  Match,
  RedactionResult,
  ReportedEntity,
  TokenMap,
} from "./types.js";
import { defaultDetectors } from "./detectors/index.js";
import { Tokenizer, rehydrate } from "./tokenizer.js";

export interface RedactorOptions {
  /** Detector set to use. Defaults to the built-in registry. */
  detectors?: Detector[];
  /** Resolve the policy action for an entity type. Defaults to always redact. */
  resolveAction?: (type: EntityType) => Action;
}

/**
 * Orchestrates detection, overlap resolution, policy, and reversible
 * tokenization. Framework-free and dependency-light so it can be embedded
 * directly in any application or wrapped by the HTTP layer.
 */
export class Redactor {
  private readonly detectors: Detector[];
  private readonly resolveAction: (type: EntityType) => Action;

  constructor(options: RedactorOptions = {}) {
    this.detectors = options.detectors ?? defaultDetectors;
    this.resolveAction = options.resolveAction ?? (() => "redact");
  }

  /** Detect PII in `text` and return a redacted copy plus a reversible map. */
  redact(text: string): RedactionResult {
    const raw = this.detectors.flatMap((d) => d.detect(text));
    const chosen = resolveOverlaps(raw);

    const tokenizer = new Tokenizer();
    const entities: ReportedEntity[] = [];
    let blocked = false;

    // Rebuild the string left-to-right, substituting placeholders for any
    // entity whose policy action is `redact` or `block`. Because `chosen` is
    // sorted by start and non-overlapping, offsets stay valid as we go.
    let out = "";
    let cursor = 0;
    for (const m of chosen) {
      const action = this.resolveAction(m.type);
      out += text.slice(cursor, m.start);

      if (action === "allow") {
        out += m.value; // leave the original text in place
      } else {
        if (action === "block") blocked = true;
        const placeholder = tokenizer.placeholderFor(m.type, m.value);
        out += placeholder;
        entities.push({
          type: m.type,
          placeholder,
          action,
          start: m.start,
          end: m.end,
        });
      }
      cursor = m.end;
    }
    out += text.slice(cursor);

    return {
      redacted: out,
      entities,
      tokenMap: tokenizer.tokenMap(),
      blocked,
    };
  }

  /** Swap placeholders in `text` back to their originals. */
  rehydrate(text: string, tokenMap: TokenMap): string {
    return rehydrate(text, tokenMap);
  }
}

/**
 * Resolve overlapping matches into a non-overlapping, start-sorted set.
 * Strategy: sort by start ascending, then by span descending, and greedily
 * keep a match only if it begins at or after the end of the last kept match.
 * This prefers longer, earlier spans and discards anything they subsume.
 */
export function resolveOverlaps(matches: Match[]): Match[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const kept: Match[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      kept.push(m);
      lastEnd = m.end;
    }
  }
  return kept;
}
