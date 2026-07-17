import type { Detector } from "../types.js";
import { matchAll } from "./util.js";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export const emailDetector: Detector = {
  type: "EMAIL",
  detect: (text) => matchAll(text, "EMAIL", EMAIL_RE),
};
