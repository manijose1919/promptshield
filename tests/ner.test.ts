import { describe, it, expect } from "vitest";
import { createHttpNerDetector } from "../src/core/detectors/ner.js";

function fakeFetch(opts: {
  spans?: unknown;
  status?: number;
  fail?: boolean;
}): typeof fetch {
  return (async () => {
    if (opts.fail) throw new Error("connection refused");
    return new Response(JSON.stringify({ spans: opts.spans ?? [] }), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("createHttpNerDetector", () => {
  it("maps returned spans to matches, slicing the value from text", async () => {
    const det = createHttpNerDetector({
      url: "http://ner/detect",
      fetchImpl: fakeFetch({ spans: [{ start: 3, end: 9, label: "PERSON" }] }),
    });
    const m = await det.detectAsync("hi Zephyr!");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ type: "NAME", start: 3, end: 9, value: "Zephyr" });
  });

  it("drops spans outside the text bounds", async () => {
    const det = createHttpNerDetector({
      url: "http://ner/detect",
      fetchImpl: fakeFetch({ spans: [{ start: 5, end: 999 }, { start: 2, end: 2 }] }),
    });
    expect(await det.detectAsync("short")).toHaveLength(0);
  });

  it("fails open to [] by default when the service is down", async () => {
    const det = createHttpNerDetector({
      url: "http://ner/detect",
      fetchImpl: fakeFetch({ fail: true }),
    });
    expect(await det.detectAsync("hi Zephyr")).toEqual([]);
  });

  it("can fail closed (throw) when configured", async () => {
    const det = createHttpNerDetector({
      url: "http://ner/detect",
      fetchImpl: fakeFetch({ fail: true }),
      onError: "throw",
    });
    await expect(det.detectAsync("hi Zephyr")).rejects.toThrow();
  });

  it("honors a custom entity type", async () => {
    const det = createHttpNerDetector({
      url: "http://ner/detect",
      entityType: "CUSTOM",
      fetchImpl: fakeFetch({ spans: [{ start: 0, end: 2 }] }),
    });
    const m = await det.detectAsync("hi");
    expect(m[0]!.type).toBe("CUSTOM");
  });
});
