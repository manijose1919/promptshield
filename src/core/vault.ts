import { randomUUID } from "node:crypto";
import type { TokenMap } from "./types.js";

/**
 * Storage for token maps behind an opaque id. Async so a single interface can
 * back both the in-process default and any networked store (Redis, Memcached,
 * DynamoDB) — every such store is async, so a synchronous contract could never
 * wrap one. `size` is optional because networked stores can't cheaply count.
 */
export interface TokenVault {
  /** Store a token map and return an opaque id for later rehydration. */
  store(map: TokenMap): Promise<string>;
  /** Retrieve a previously stored token map, or undefined if absent/expired. */
  get(id: string): Promise<TokenMap | undefined>;
  /** Number of live entries. Optional — primarily for tests/metrics. */
  size?(): Promise<number>;
}

interface Entry {
  map: TokenMap;
  expiresAt: number;
}

/**
 * In-memory token vault with TTL and a bounded size. Token maps hold real PII,
 * so they are intentionally ephemeral — the default TTL keeps them only long
 * enough to rehydrate a model response, then they evaporate. For a multi-
 * instance deployment, swap this for {@link KeyValueTokenVault}.
 */
export class InMemoryTokenVault implements TokenVault {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async store(map: TokenMap): Promise<string> {
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

  async get(id: string): Promise<TokenMap | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.map;
  }

  async size(): Promise<number> {
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

/**
 * The minimal async key/value contract {@link KeyValueTokenVault} needs. It is
 * deliberately tiny so a production adapter is a few lines over `node-redis` or
 * `ioredis` — PromptShield never takes on the dependency itself:
 *
 * ```ts
 * import { createClient } from "redis";
 * const redis = createClient(); await redis.connect();
 * const store: AsyncKeyValueStore = {
 *   get: (k) => redis.get(k).then((v) => v ?? undefined),
 *   set: (k, v, ttlMs) => redis.set(k, v, { PX: ttlMs }).then(() => {}),
 * };
 * const vault = new KeyValueTokenVault(store);
 * ```
 */
export interface AsyncKeyValueStore {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

/**
 * Token vault backed by any {@link AsyncKeyValueStore}. This is what makes
 * `token_map_id` resolvable across a horizontally-scaled deployment: every
 * instance reads and writes the same shared store. Maps are JSON-serialized and
 * namespaced so the store can be shared with unrelated application data.
 */
export class KeyValueTokenVault implements TokenVault {
  constructor(
    private readonly kv: AsyncKeyValueStore,
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly prefix = "ps:tm:",
    private readonly genId: () => string = randomUUID,
  ) {}

  async store(map: TokenMap): Promise<string> {
    const id = this.genId();
    await this.kv.set(this.prefix + id, JSON.stringify(map), this.ttlMs);
    return id;
  }

  async get(id: string): Promise<TokenMap | undefined> {
    const raw = await this.kv.get(this.prefix + id);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as TokenMap;
    } catch {
      // A corrupt/foreign value under our namespace: treat as a miss rather
      // than throwing into the request path.
      return undefined;
    }
  }
}
