import type { Detector } from "../types.js";
import { matchAll } from "./util.js";

/** JSON Web Tokens: three base64url segments; header always starts `eyJ`. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/**
 * Common high-confidence API-key / credential shapes. Kept intentionally
 * specific (known prefixes) to minimize false positives on ordinary tokens.
 */
const API_KEY_RE = new RegExp(
  [
    "sk-[A-Za-z0-9]{20,}", // OpenAI-style secret keys
    "AKIA[0-9A-Z]{16}", // AWS access key id
    "gh[pousr]_[A-Za-z0-9]{20,}", // GitHub tokens
    "xox[baprs]-[A-Za-z0-9-]{10,}", // Slack tokens
    "AIza[0-9A-Za-z_-]{20,}", // Google API key
  ].join("|"),
  "g",
);

export const jwtDetector: Detector = {
  type: "JWT",
  detect: (text) => matchAll(text, "JWT", JWT_RE),
};

export const apiKeyDetector: Detector = {
  type: "API_KEY",
  detect: (text) => matchAll(text, "API_KEY", API_KEY_RE),
};
