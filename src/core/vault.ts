import { randomUUID } from "node:crypto";
import type { TokenMap } from "./types.js";

export interface TokenVault {
  /** Store a token map and return an opaque id for later rehydration. */
  store(map: TokenMap): string;
  /** Retrieve a previously stored token map, or undefined if absent/expired. */
  get(id: string): TokenMap | undefined;
  /** Number of live entries (post-purge). Primarily for tests/metrics. */
  size(): number;
}

interface Entry {
  map: TokenMap;
  expiresAt: number;
}

/**
 * In-memory token vault with TTL and a bounded size. Token maps hold real PII,
 * so they are intentionally ephemeral — the default TTL keeps them only long
 * enough to rehydrate a model response, then they evaporate. A production
 * deployment can swap this for a Redis-backed implementation of TokenVault.
 */
export class InMemoryTokenVault implements TokenVault {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  store(map: TokenMap): string {
    this.purgeExpired();
    if (this.entries.size >= this.maxEntries) {
      // Evict the oldest inserted entry (Map preserves insertion order).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const id = randomUUID();
    this.entries.set(id, { map, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  get(id: string): TokenMap | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.map;
  }

  size(): number {
    this.purgeExpired();
    return this.entries.size;
  }

  private purgeExpired(): void {
    const t = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= t) this.entries.delete(id);
    }
  }
}
