import type { Detector, Match } from "../types.js";

// Honorific + 1-3 capitalized words: "Dr. Alice Chen". The whole span is PII.
const HONORIFIC_RE =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Miss|Sir|Mx)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g;

// Introduction cue + captured name. The cue casings are enumerated (rather than
// the /i flag) so the NAME group stays strictly case-sensitive: [A-Z][a-z]+ must
// remain "capitalized word", which the /i flag would wrongly relax.
const CUE_RE =
  /(?:[Mm]y name is|[Nn]ame is|[Ii] am|[Ii]'m|[Tt]his is|[Nn]ame:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gd;

/**
 * Detects person names — but ONLY when cued (an honorific, or an introduction
 * like "my name is …"). Open-vocabulary name detection needs a model; the
 * cue requirement keeps this heuristic's false-positive rate low without one.
 * For bare, uncued names, wire an NER model via the async detection seam
 * (see detectors/index — `AsyncDetector`).
 */
export const nameDetector: Detector = {
  type: "NAME",
  detect(text: string): Match[] {
    const out: Match[] = [];

    for (const m of text.matchAll(new RegExp(HONORIFIC_RE.source, "g"))) {
      const value = m[0];
      const start = m.index ?? 0;
      out.push({ type: "NAME", start, end: start + value.length, value });
    }

    for (const m of text.matchAll(new RegExp(CUE_RE.source, "gd"))) {
      const value = m[1];
      const span = (m as unknown as { indices?: Array<[number, number]> })
        .indices?.[1];
      if (!value || !span) continue;
      out.push({ type: "NAME", start: span[0], end: span[0] + value.length, value });
    }

    return out;
  },
};
