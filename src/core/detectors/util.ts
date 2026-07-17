import type { EntityType, Match } from "../types.js";

/**
 * Run a global regex over text and turn every hit into a Match. The regex MUST
 * carry the global flag; we clone it per call so detectors stay stateless and
 * safe to reuse (lastIndex on a shared /g regex is a classic footgun).
 */
export function matchAll(
  text: string,
  type: EntityType,
  pattern: RegExp,
): Match[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const out: Match[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[0];
    const start = m.index ?? 0;
    if (value.length === 0) continue;
    out.push({ type, start, end: start + value.length, value });
  }
  return out;
}
