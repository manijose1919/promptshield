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
import { maskValue } from "./mask.js";

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
    const tokenizer = new Tokenizer();
    const { redacted, entities, blocked } = this.redactWith(text, tokenizer);
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

  /** Core redaction pass against a caller-supplied tokenizer. */
  private redactWith(
    text: string,
    tokenizer: Tokenizer,
  ): { redacted: string; entities: ReportedEntity[]; blocked: boolean } {
    const raw = this.detectors.flatMap((d) => d.detect(text));
    const chosen = resolveOverlaps(raw);

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
