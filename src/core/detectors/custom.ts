import type { Detector, Match } from "../types.js";

export interface CustomRuleSpec {
  /** Human-readable name; becomes the placeholder label, e.g. "employee id". */
  name: string;
  /** One of `pattern` (regex source) or `terms` (literal strings) is required. */
  pattern?: string;
  /** Regex flags; `g` is always enforced. Default "". */
  flags?: string;
  /** Literal terms to match (case-insensitive, whole-word). */
  terms?: string[];
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Hard cap so a config typo cannot feed a multi-kilobyte regex into the event loop. */
export const MAX_CUSTOM_PATTERN_LENGTH = 256;

/**
 * Nested quantifiers like `(a+)+` / `(a*){2,}` are the classic catastrophic
 * backtracking shape. Custom rules are operator-supplied, but they still run
 * on every request — reject the known-bad forms at config load rather than
 * hanging the process later.
 */
const NESTED_QUANTIFIER = /(\([^)]*[+*{?][^)]*\)|\[[^\]]*[+*{?][^\]]*\])[+*{]/;

export function assertSafeCustomPattern(name: string, pattern: string): void {
  if (pattern.length > MAX_CUSTOM_PATTERN_LENGTH) {
    throw new Error(
      `Custom rule "${name}" pattern exceeds ${MAX_CUSTOM_PATTERN_LENGTH} characters.`,
    );
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new Error(
      `Custom rule "${name}" pattern looks catastrophically backtracking (nested quantifiers). Rewrite it without nested +/*/{}.`,
    );
  }
}

/**
 * Build a detector from a user-supplied rule. Custom detectors emit matches of
 * type "CUSTOM" carrying the rule name as `label`, so they flow through the
 * exact same tokenizer/policy/rehydrate pipeline as built-ins.
 *
 * Throws if the rule is malformed (bad regex, or neither pattern nor terms) —
 * fail fast at configuration time, never silently ignore a redaction rule.
 */
export function createCustomDetector(spec: CustomRuleSpec): Detector {
  const label = spec.name;
  let source: string;

  if (spec.pattern && spec.pattern.length > 0) {
    assertSafeCustomPattern(spec.name, spec.pattern);
    source = spec.pattern;
  } else if (spec.terms && spec.terms.length > 0) {
    source = `\\b(?:${spec.terms.map(escapeRegExp).join("|")})\\b`;
  } else {
    throw new Error(
      `Custom rule "${spec.name}" must define either "pattern" or "terms".`,
    );
  }

  const rawFlags = spec.flags ?? "";
  const flags = rawFlags.includes("g") ? rawFlags : rawFlags + "g";
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch (err) {
    throw new Error(
      `Custom rule "${spec.name}" has an invalid regex: ${(err as Error).message}`,
    );
  }

  return {
    type: "CUSTOM",
    detect(text: string): Match[] {
      // Clone per call so lastIndex state never leaks between invocations.
      const local = new RegExp(re.source, re.flags);
      const out: Match[] = [];
      for (const m of text.matchAll(local)) {
        const value = m[0];
        if (value.length === 0) continue;
        const start = m.index ?? 0;
        out.push({ type: "CUSTOM", start, end: start + value.length, value, label });
      }
      return out;
    },
  };
}

/** Build a list of custom detectors, validating every rule up front. */
export function buildCustomDetectors(specs: CustomRuleSpec[]): Detector[] {
  return specs.map(createCustomDetector);
}
