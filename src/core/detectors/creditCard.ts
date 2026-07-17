import type { Detector, Match } from "../types.js";

/** Candidate runs of 13–19 digits, optionally grouped by spaces or dashes. */
const CANDIDATE_RE = /\b\d(?:[ -]?\d){12,18}\b/g;

/**
 * Luhn (mod-10) checksum — the algorithm real card issuers use. Validating it
 * turns "any 16 digits" into "a plausible card number", cutting false
 * positives dramatically (order numbers, IDs, etc. rarely pass Luhn).
 */
export function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const code = digits.charCodeAt(i);
    if (code < 48 || code > 57) return false;
    let d = code - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export const creditCardDetector: Detector = {
  type: "CREDIT_CARD",
  detect(text): Match[] {
    const out: Match[] = [];
    for (const m of text.matchAll(CANDIDATE_RE)) {
      const value = m[0];
      const digits = value.replace(/[ -]/g, "");
      if (!luhnValid(digits)) continue;
      const start = m.index ?? 0;
      out.push({ type: "CREDIT_CARD", start, end: start + value.length, value });
    }
    return out;
  },
};
