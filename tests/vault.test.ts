import { describe, it, expect } from "vitest";
import {
  InMemoryTokenVault,
  KeyValueTokenVault,
  type AsyncKeyValueStore,
} from "../src/core/vault.js";
import type { TokenMap } from "../src/core/types.js";

const sampleMap = (): TokenMap => ({ entries: { "[EMAIL_1]": "jane@acme.com" } });

/** A trivial Map-backed async store — the same shape a Redis adapter fills. */
function fakeStore(now = () => 0): AsyncKeyValueStore & {
  setCalls: Array<{ key: string; ttlMs: number }>;
} {
  const data = new Map<string, { value: string; expiresAt: number }>();
  const setCalls: Array<{ key: string; ttlMs: number }> = [];
  return {
    setCalls,
    async set(key, value, ttlMs) {
      setCalls.push({ key, ttlMs });
      data.set(key, { value, expiresAt: now() + ttlMs });
    },
    async get(key) {
      const e = data.get(key);
      if (!e) return undefined;
      if (e.expiresAt <= now()) {
        data.delete(key);
        return undefined;
      }
      return e.value;
    },
  };
}

describe("InMemoryTokenVault (async)", () => {
  it("stores and retrieves a map by id", async () => {
    const vault = new InMemoryTokenVault();
    const id = await vault.store(sampleMap());
    expect(typeof id).toBe("string");
    expect((await vault.get(id))?.entries["[EMAIL_1]"]).toBe("jane@acme.com");
  });

  it("returns undefined after the TTL elapses", async () => {
    let t = 1000;
    const vault = new InMemoryTokenVault(60_000, 10_000, () => t);
    const id = await vault.store(sampleMap());
    t += 60_001;
    expect(await vault.get(id)).toBeUndefined();
  });

  it("evicts the oldest entry at capacity", async () => {
    const vault = new InMemoryTokenVault(60_000, 2);
    const a = await vault.store(sampleMap());
    await vault.store(sampleMap());
    await vault.store(sampleMap()); // overflow → evicts `a`
    expect(await vault.get(a)).toBeUndefined();
    expect(await vault.size()).toBe(2);
  });
});

describe("KeyValueTokenVault (Redis-ready seam)", () => {
  it("round-trips a map through an injected async store", async () => {
    const vault = new KeyValueTokenVault(fakeStore());
    const id = await vault.store(sampleMap());
    expect((await vault.get(id))?.entries["[EMAIL_1]"]).toBe("jane@acme.com");
  });

  it("returns undefined for an unknown id", async () => {
    const vault = new KeyValueTokenVault(fakeStore());
    expect(await vault.get("nope")).toBeUndefined();
  });

  it("passes its TTL to the backing store's set()", async () => {
    const store = fakeStore();
    const vault = new KeyValueTokenVault(store, 42_000);
    await vault.store(sampleMap());
    expect(store.setCalls[0]!.ttlMs).toBe(42_000);
  });

  it("namespaces keys so it can share a store with other data", async () => {
    const store = fakeStore();
    const vault = new KeyValueTokenVault(store);
    await vault.store(sampleMap());
    expect(store.setCalls[0]!.key.startsWith("ps:tm:")).toBe(true);
  });
});
