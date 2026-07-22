import { describe, it, expect } from "vitest";
import { Redactor, resolveOverlaps } from "../src/core/redactor.js";
import type { AsyncDetector, Match } from "../src/core/types.js";

/** A fake NER-style async detector that flags a made-up name only it knows. */
const zephyrNer: AsyncDetector = {
  type: "NAME",
  async detectAsync(text: string): Promise<Match[]> {
    const out: Match[] = [];
    for (const m of text.matchAll(/\bZephyr\b/g)) {
      const start = m.index ?? 0;
      out.push({ type: "NAME", start, end: start + m[0].length, value: m[0] });
    }
    return out;
  },
};

describe("Redactor.redact", () => {
  it("redacts multiple entity types and reports them", () => {
    const r = new Redactor();
    const res = r.redact("Email jane@acme.com or call 415-555-0132");
    expect(res.redacted).toBe("Email [EMAIL_1] or call [PHONE_1]");
    expect(res.entities.map((e) => e.type).sort()).toEqual(["EMAIL", "PHONE"]);
    expect(res.blocked).toBe(false);
  });

  it("collapses repeated values to one stable placeholder", () => {
    const r = new Redactor();
    const res = r.redact("a@b.com and again a@b.com");
    expect(res.redacted).toBe("[EMAIL_1] and again [EMAIL_1]");
    expect(Object.keys(res.tokenMap.entries)).toEqual(["[EMAIL_1]"]);
  });

  it("round-trips via rehydrate", () => {
    const r = new Redactor();
    const original = "Reach me: jane@acme.com / 4111 1111 1111 1111";
    const res = r.redact(original);
    expect(r.rehydrate(res.redacted, res.tokenMap)).toBe(original);
  });

  it("honors an allow policy (leaves text untouched)", () => {
    const r = new Redactor({ resolveAction: () => "allow" });
    const res = r.redact("jane@acme.com");
    expect(res.redacted).toBe("jane@acme.com");
    expect(res.entities).toHaveLength(0);
  });

  it("flags blocked when policy is block", () => {
    const r = new Redactor({ resolveAction: () => "block" });
    const res = r.redact("ssn 123-45-6789");
    expect(res.blocked).toBe(true);
    expect(res.entities[0]!.action).toBe("block");
  });

  it("does not corrupt [EMAIL_1] vs [EMAIL_11] on rehydrate", () => {
    const r = new Redactor();
    // Force 11 distinct emails so placeholders reach two digits.
    const emails = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`);
    const text = emails.join(" ");
    const res = r.redact(text);
    expect(r.rehydrate(res.redacted, res.tokenMap)).toBe(text);
  });
});

describe("Redactor.redactAsync", () => {
  it("consults async detectors and redacts what only they find", async () => {
    const r = new Redactor({ asyncDetectors: [zephyrNer] });
    const res = await r.redactAsync("hello Zephyr and jane@acme.com");
    // Zephyr has no honorific/cue, so only the async NER catches it.
    expect(res.redacted).toBe("hello [NAME_1] and [EMAIL_1]");
  });

  it("with no async detectors, matches sync redact() exactly", async () => {
    const r = new Redactor();
    const text = "email jane@acme.com or call 415-555-0132";
    const asyncRes = await r.redactAsync(text);
    expect(asyncRes.redacted).toBe(r.redact(text).redacted);
  });

  it("redactBatchAsync shares placeholders across texts", async () => {
    const r = new Redactor({ asyncDetectors: [zephyrNer] });
    const res = await r.redactBatchAsync(["Zephyr here", "and Zephyr again"]);
    expect(res.redacted).toEqual(["[NAME_1] here", "and [NAME_1] again"]);
  });
});

describe("resolveOverlaps", () => {
  it("keeps the longer of two overlapping matches", () => {
    const matches: Match[] = [
      { type: "PHONE", start: 0, end: 8, value: "555-1234" },
      { type: "CREDIT_CARD", start: 0, end: 16, value: "5551234567890123" },
    ];
    const kept = resolveOverlaps(matches);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.type).toBe("CREDIT_CARD");
  });

  it("keeps disjoint matches in order", () => {
    const matches: Match[] = [
      { type: "EMAIL", start: 10, end: 20, value: "a@b.com" },
      { type: "EMAIL", start: 0, end: 5, value: "c@d.com" },
    ];
    const kept = resolveOverlaps(matches);
    expect(kept.map((m) => m.start)).toEqual([0, 10]);
  });
});
