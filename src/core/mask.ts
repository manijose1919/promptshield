import type { EntityType } from "./types.js";

/** Replace every ASCII alphanumeric char in `s` with `ch`, preserving others. */
function maskAlnum(s: string, ch = "*"): string {
  return s.replace(/[A-Za-z0-9]/g, ch);
}

/** Keep the last `keep` alphanumerics; mask the rest (separators preserved). */
function keepLast(s: string, keep: number, ch = "*"): string {
  let seen = 0;
  const chars = [...s];
  for (let i = chars.length - 1; i >= 0; i--) {
    if (/[A-Za-z0-9]/.test(chars[i]!)) {
      if (seen < keep) seen++;
      else chars[i] = ch;
    }
  }
  return chars.join("");
}

/**
 * Produce a human-friendly, NON-reversible masked form of a detected value.
 * Masking trades reversibility for utility: the model still sees the shape of
 * the data ("a card ending 1111", "an email at acme.com") without the secret.
 */
export function maskValue(type: EntityType, value: string, label?: string): string {
  switch (type) {
    case "CREDIT_CARD":
      return keepLast(value, 4);
    case "PHONE":
      return keepLast(value, 4);
    case "SSN":
      return keepLast(value, 4);
    case "EMAIL": {
      const at = value.indexOf("@");
      if (at <= 0) return maskAlnum(value);
      const local = value.slice(0, at);
      const domain = value.slice(at); // includes '@'
      const firstChar = local[0] ?? "";
      return `${firstChar}${"*".repeat(Math.max(local.length - 1, 1))}${domain}`;
    }
    case "IPV4":
    case "IPV6":
    case "JWT":
    case "API_KEY":
      return keepLast(value, 4);
    case "DATE":
    case "ADDRESS":
    case "NAME":
      // Heuristic identifiers: reveal nothing — a partial name/date/address is
      // still identifying. Full mask, separators preserved.
      return maskAlnum(value);
    case "CUSTOM":
    default: {
      // Unknown/custom: keep the last 2 chars when there's enough to hide
      // meaningfully, otherwise mask the whole thing.
      void label;
      const alnum = (value.match(/[A-Za-z0-9]/g) ?? []).length;
      return alnum > 4 ? keepLast(value, 2) : maskAlnum(value);
    }
  }
}
