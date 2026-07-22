import type { Detector, Match } from "../types.js";
import { matchAll } from "./util.js";

const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|" +
  "Way|Circle|Cir|Place|Pl|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Square|Sq|Trail|Trl";
const UNIT = "Apt|Apartment|Suite|Ste|Unit|Room|Rm|#";

/**
 * A US street address: a house number, up to four street-name words, a street
 * suffix, and an optional unit. Requires the leading number AND a suffix, so it
 * won't fire on "5 apples". Heuristic — precision over recall on street forms.
 */
const ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s+){0,4}(?:${STREET_SUFFIX})\\b\\.?` +
    `(?:,?\\s+(?:${UNIT})\\.?\\s*#?\\s*\\w+)?`,
  "gi",
);

/** Detects US-style street addresses (a HIPAA/GDPR identifier). */
export const addressDetector: Detector = {
  type: "ADDRESS",
  detect: (text: string): Match[] => matchAll(text, "ADDRESS", ADDRESS_RE),
};
