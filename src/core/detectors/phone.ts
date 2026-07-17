import type { Detector } from "../types.js";
import { matchAll } from "./util.js";

/**
 * North-American / international style phone numbers: optional +country code,
 * optional parenthesized area code, common separators. The digit lookarounds
 * stop us from biting into longer digit runs (e.g. credit-card numbers).
 */
const PHONE_RE =
  /(?<![\d\w])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\d\w])/g;

export const phoneDetector: Detector = {
  type: "PHONE",
  detect: (text) => matchAll(text, "PHONE", PHONE_RE),
};
