import type {
  Action,
  AsyncDetector,
  Detector,
  EntityType,
  Match,
  RedactionResult,
  ReportedEntity,
  TokenMap,
} from "./types.js";
import { defaultDetectors } from "./detectors/index.js";
import { Tokenizer, rehydrate } from "./tokenizer.js";
import { maskValue } from "./mask.js";

export interface RedactorOptions {
  /** Detector set to use. Defaults to the built-in registry. */
  detectors?: Detector[];
  /**
   * Optional model-backed detectors, consulted only by the async methods
   * (`redactAsync` / `redactBatchAsync`). The sync API ignores them.
   */
  asyncDetectors?: AsyncDetector[];
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
  private readonly asyncDetectors: AsyncDetector[];
  private readonly resolveAction: (type: EntityType) => Action;

  constructor(options: RedactorOptions = {}) {
    this.detectors = options.detectors ?? defaultDetectors;
    this.asyncDetectors = options.asyncDetectors ?? [];
    this.resolveAction = options.resolveAction ?? (() => "redact");
  }

  /**
   * Detect PII in `text` and return a redacted copy plus a reversible map.
   * An optional `resolveOverride` lets a single call use a different policy
   * (e.g. per-request overrides) without mutating this Redactor.
   */
  redact(
    text: string,
    resolveOverride?: (type: EntityType) => Action,
  ): RedactionResult {
    const tokenizer = new Tokenizer();
    const { redacted, entities, blocked } = this.redactWith(
      text,
      tokenizer,
      resolveOverride,
    );
    return { redacted, entities, tokenMap: tokenizer.tokenMap(), blocked };
  }

  /**
   * Redact several strings under a SHARED tokenizer so the same value maps to
   * the same placeholder across all of them. Essential for the chat proxy:
   * an email appearing in both the system and user message must become the
   * same `[EMAIL_1]` in each, and rehydrate unambiguously from one map.
   */
  redactBatch(texts: string[]): {
    redacted: string[];
    entities: ReportedEntity[];
    tokenMap: TokenMap;
    blocked: boolean;
  } {
    const tokenizer = new Tokenizer();
    const redacted: string[] = [];
    const entities: ReportedEntity[] = [];
    let blocked = false;
    for (const text of texts) {
      const r = this.redactWith(text, tokenizer);
      redacted.push(r.redacted);
      entities.push(...r.entities);
      if (r.blocked) blocked = true;
    }
    return { redacted, entities, tokenMap: tokenizer.tokenMap(), blocked };
  }

  /**
   * Detect PII using BOTH sync and async detectors. Behaves exactly like
   * {@link redact} when no async detectors are configured. Use this to consult
   * a model-backed detector (e.g. an NER service) wired via `asyncDetectors`.
   */
  async redactAsync(
    text: string,
    resolveOverride?: (type: EntityType) => Action,
  ): Promise<RedactionResult> {
    const tokenizer = new Tokenizer();
    const raw = await this.detectAll(text);
    const { redacted, entities, blocked } = this.applyMatches(
      text,
      raw,
      tokenizer,
      resolveOverride ?? this.resolveAction,
    );
    return { redacted, entities, tokenMap: tokenizer.tokenMap(), blocked };
  }

  /** Async counterpart of {@link redactBatch} (shared tokenizer across texts). */
  async redactBatchAsync(
    texts: string[],
    resolveOverride?: (type: EntityType) => Action,
  ): Promise<{
    redacted: string[];
    entities: ReportedEntity[];
    tokenMap: TokenMap;
    blocked: boolean;
  }> {
    const resolve = resolveOverride ?? this.resolveAction;
    const tokenizer = new Tokenizer();
    const redacted: string[] = [];
    const entities: ReportedEntity[] = [];
    let blocked = false;
    for (const text of texts) {
      const raw = await this.detectAll(text);
      const r = this.applyMatches(text, raw, tokenizer, resolve);
      redacted.push(r.redacted);
      entities.push(...r.entities);
      if (r.blocked) blocked = true;
    }
    return { redacted, entities, tokenMap: tokenizer.tokenMap(), blocked };
  }

  /** Run sync detectors plus (awaited, parallel) async detectors. */
  private async detectAll(text: string): Promise<Match[]> {
    const sync = this.detectors.flatMap((d) => d.detect(text));
    if (this.asyncDetectors.length === 0) return sync;
    const async = await Promise.all(
      this.asyncDetectors.map((d) => d.detectAsync(text)),
    );
    return [...sync, ...async.flat()];
  }

  /** Core redaction pass against a caller-supplied tokenizer. */
  private redactWith(
    text: string,
    tokenizer: Tokenizer,
    resolveOverride?: (type: EntityType) => Action,
  ): { redacted: string; entities: ReportedEntity[]; blocked: boolean } {
    const raw = this.detectors.flatMap((d) => d.detect(text));
    return this.applyMatches(
      text,
      raw,
      tokenizer,
      resolveOverride ?? this.resolveAction,
    );
  }

  /**
   * Resolve overlaps among `raw`, then rebuild `text` left-to-right applying the
   * policy action per match against the shared `tokenizer`. This is the single
   * substitution engine behind both the sync and async detection paths.
   */
  private applyMatches(
    text: string,
    raw: Match[],
    tokenizer: Tokenizer,
    resolve: (type: EntityType) => Action,
  ): { redacted: string; entities: ReportedEntity[]; blocked: boolean } {
    const chosen = resolveOverlaps(raw);

    const entities: ReportedEntity[] = [];
    let blocked = false;

    // Rebuild the string left-to-right, substituting placeholders for any
    // entity whose policy action is `redact` or `block`. Because `chosen` is
    // sorted by start and non-overlapping, offsets stay valid as we go.
    let out = "";
    let cursor = 0;
    for (const m of chosen) {
      const action = resolve(m.type);
      out += text.slice(cursor, m.start);

      const label = m.label ?? m.type;
      if (action === "allow") {
        out += m.value; // leave the original text in place
      } else if (action === "mask") {
        // Masking is intentionally NON-reversible: no token-map entry.
        const masked = maskValue(m.type, m.value, m.label);
        out += masked;
        entities.push({
          type: m.type,
          label,
          placeholder: masked,
          action,
          start: m.start,
          end: m.end,
        });
      } else {
        if (action === "block") blocked = true;
        const placeholder = tokenizer.placeholderFor(m.type, m.value, m.label);
        out += placeholder;
        entities.push({
          type: m.type,
          label,
          placeholder,
          action,
          start: m.start,
          end: m.end,
        });
      }
      cursor = m.end;
    }
    out += text.slice(cursor);

    return { redacted: out, entities, blocked };
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
