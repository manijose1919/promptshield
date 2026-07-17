import type { Detector } from "../types.js";
import { matchAll } from "./util.js";

/**
 * US Social Security Numbers in the conventional AAA-GG-SSSS shape (dash or
 * space separated). We deliberately avoid matching bare 9-digit runs — they
 * collide with far too many non-PII identifiers to redact safely.
 */
const SSN_RE = /\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g;

export const ssnDetector: Detector = {
  type: "SSN",
  detect: (text) => matchAll(text, "SSN", SSN_RE),
};
