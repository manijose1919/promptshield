import type { Detector, Match } from "../types.js";
import { matchAll } from "./util.js";

// Numeric dates: M/D/YYYY, M-D-YY (1-2 digit day/month so SSN/phone shapes,
// which start with 3-digit groups, never match).
const NUMERIC_RE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
// ISO dates: YYYY-MM-DD.
const ISO_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December|" +
  "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
// "March 14, 1990" / "Mar 14 1990".
const MONTH_FIRST_RE = new RegExp(
  `\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
  "gi",
);
// "14 March 1990".
const DAY_FIRST_RE = new RegExp(
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`,
  "gi",
);

/**
 * Detects dates (a HIPAA identifier and common date-of-birth leak). Heuristic:
 * matches structured numeric, ISO, and month-name forms — deliberately NOT bare
 * years, which are rarely PII on their own and would flood with false positives.
 */
export const dateDetector: Detector = {
  type: "DATE",
  detect(text: string): Match[] {
    return [
      ...matchAll(text, "DATE", ISO_RE),
      ...matchAll(text, "DATE", NUMERIC_RE),
      ...matchAll(text, "DATE", MONTH_FIRST_RE),
      ...matchAll(text, "DATE", DAY_FIRST_RE),
    ];
  },
};
