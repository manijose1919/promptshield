import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/server/rateLimiter.js";

describe("RateLimiter (token bucket)", () => {
  it("allows up to capacity, then blocks", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1 / 1000, () => t); // cap 2, +1 token/1000ms
    expect(rl.take("k").allowed).toBe(true);
    expect(rl.take("k").allowed).toBe(true);
    const blocked = rl.take("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000); // one token = 1000ms away
  });

  it("refills over time", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1 / 1000, () => t);
    rl.take("k");
    rl.take("k");
    expect(rl.take("k").allowed).toBe(false);
    t = 1000; // one token refilled
    expect(rl.take("k").allowed).toBe(true);
    expect(rl.take("k").allowed).toBe(false);
  });

  it("never refills beyond capacity", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1 / 1000, () => t);
    t = 10_000; // long idle
    expect(rl.take("k").allowed).toBe(true);
    expect(rl.take("k").allowed).toBe(true);
    expect(rl.take("k").allowed).toBe(false); // still only capacity, not 10
  });

  it("tracks separate keys independently", () => {
    const rl = new RateLimiter(1, 1 / 1000, () => 0);
    expect(rl.take("a").allowed).toBe(true);
    expect(rl.take("a").allowed).toBe(false);
    expect(rl.take("b").allowed).toBe(true); // b has its own budget
  });

  it("reports remaining tokens", () => {
    const rl = new RateLimiter(3, 0, () => 0);
    expect(rl.take("k").remaining).toBe(2);
    expect(rl.take("k").remaining).toBe(1);
    expect(rl.take("k").remaining).toBe(0);
  });
});
