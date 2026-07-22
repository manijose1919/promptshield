import { describe, it, expect } from "vitest";
import { StreamRehydrator } from "../src/core/streamRehydrator.js";
import type { TokenMap } from "../src/core/types.js";

const MAP: TokenMap = {
  entries: { "[EMAIL_1]": "jane@acme.com", "[PHONE_1]": "415-555-0132" },
};

/** Feed text through the rehydrator in arbitrary chunks and concatenate. */
function stream(map: TokenMap, chunks: string[]): string {
  const r = new StreamRehydrator(map);
  return chunks.map((c) => r.push(c)).join("") + r.flush();
}

describe("StreamRehydrator", () => {
  it("rehydrates a placeholder wholly inside one chunk", () => {
    expect(stream(MAP, ["I emailed [EMAIL_1] today"])).toBe(
      "I emailed jane@acme.com today",
    );
  });

  it("rehydrates a placeholder split across two chunks", () => {
    expect(stream(MAP, ["I emailed [EMA", "IL_1] today"])).toBe(
      "I emailed jane@acme.com today",
    );
  });

  it("rehydrates a placeholder split across three chunks", () => {
    expect(stream(MAP, ["ping [", "EMAIL", "_1] now"])).toBe(
      "ping jane@acme.com now",
    );
  });

  it("does not emit a partial placeholder before it is complete", () => {
    const r = new StreamRehydrator(MAP);
    expect(r.push("call [PHO")).toBe("call "); // holds "[PHO"
    expect(r.push("NE_1]!")).toBe("415-555-0132!");
  });

  it("passes through text with no placeholders unchanged", () => {
    expect(stream(MAP, ["just ", "plain text"])).toBe("just plain text");
  });

  it("leaves bracketed non-placeholder text alone", () => {
    expect(stream(MAP, ["see [note 1] and [EMAIL_1]"])).toBe(
      "see [note 1] and jane@acme.com",
    );
  });

  it("handles two placeholders in a single stream", () => {
    expect(stream(MAP, ["[EMAIL_1] / ", "[PHONE_1]"])).toBe(
      "jane@acme.com / 415-555-0132",
    );
  });

  it("flushes a held incomplete tail that never completes", () => {
    // A lone '[' at end is held, then released verbatim on flush.
    expect(stream(MAP, ["trailing ["])).toBe("trailing [");
  });

  it("releases an over-long token-like run instead of buffering forever", () => {
    const long = "[" + "A".repeat(200);
    expect(stream(MAP, [long + " end"])).toBe(long + " end");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(stream(MAP, ["[SSN_9] here"])).toBe("[SSN_9] here");
  });
});
