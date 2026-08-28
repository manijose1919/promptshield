import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

function buildApp(env: NodeJS.ProcessEnv = {}): FastifyInstance {
  const config = loadConfig({
    LOG_LEVEL: "silent",
    AUDIT_SINK: "none",
    ...env,
  });
  return createApp(config);
}

describe("security headers", () => {
  it("sets nosniff / DENY / no-referrer on every response", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    await app.close();
  });
});

describe("health", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "promptshield" });
  });
});

describe("POST /v1/redact", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("redacts and returns a token map", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "email jane@acme.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.redacted).toBe("email [EMAIL_1]");
    expect(body.token_map.entries["[EMAIL_1]"]).toBe("jane@acme.com");
    expect(body.entities[0]).toMatchObject({ type: "EMAIL", action: "redact" });
  });

  it("rejects an oversized/invalid body via schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { notText: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("stores a token map when asked and rehydrates by id", async () => {
    const redactRes = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "call 415-555-0132", store_token_map: true },
    });
    const { redacted, token_map_id, token_map } = redactRes.json();
    expect(token_map_id).toBeTruthy();
    // Vault path must NOT also echo raw PII back inline.
    expect(token_map).toBeUndefined();

    const rehydrateRes = await app.inject({
      method: "POST",
      url: "/v1/rehydrate",
      payload: { text: redacted, token_map_id },
    });
    expect(rehydrateRes.statusCode).toBe(200);
    expect(rehydrateRes.json().text).toBe("call 415-555-0132");
  });

  it("returns 422 when policy blocks", async () => {
    const blocking = buildApp({ DEFAULT_ACTION: "block" });
    const res = await blocking.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "ssn 123-45-6789" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("blocked");
    await blocking.close();
  });

  it("rehydrate without a map returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/rehydrate",
      payload: { text: "nothing here" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("async detector seam", () => {
  it("createApp consults injected async detectors on /v1/redact", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none" });
    const app = createApp(config, {
      asyncDetectors: [
        {
          type: "NAME",
          async detectAsync(text: string) {
            const out = [];
            for (const m of text.matchAll(/\bZephyr\b/g)) {
              const start = m.index ?? 0;
              out.push({
                type: "NAME" as const,
                start,
                end: start + m[0].length,
                value: m[0],
              });
            }
            return out;
          },
        },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "hi Zephyr" },
    });
    expect(res.json().redacted).toBe("hi [NAME_1]");
    await app.close();
  });
});

describe("per-API-key policies", () => {
  const keyPolicies = JSON.stringify({
    "blocker-key": { default: "block" },
    "mask-key": { overrides: { EMAIL: "mask" } },
  });

  function keyedApp() {
    return buildApp({
      PROMPTSHIELD_API_KEYS: "plain-key",
      PROMPTSHIELD_KEY_POLICIES: keyPolicies,
    });
  }

  it("applies a key's default action (block) only for that key", async () => {
    const app = keyedApp();
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer blocker-key" },
      payload: { text: "ssn 123-45-6789" },
    });
    expect(blocked.statusCode).toBe(422);

    const plain = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer plain-key" },
      payload: { text: "ssn 123-45-6789" },
    });
    expect(plain.statusCode).toBe(200); // server default = redact
    await app.close();
  });

  it("applies a key's per-type override (mask email)", async () => {
    const app = keyedApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer mask-key" },
      payload: { text: "reach jane@acme.com" },
    });
    expect(res.json().redacted).toBe("reach j***@acme.com");
    await app.close();
  });

  it("lets a request-level policy override the key policy", async () => {
    const app = keyedApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer mask-key" },
      payload: { text: "jane@acme.com", policy: { overrides: { EMAIL: "allow" } } },
    });
    expect(res.json().redacted).toBe("jane@acme.com");
    await app.close();
  });

  it("authorizes a key listed only in PROMPTSHIELD_KEY_POLICIES", async () => {
    const app = buildApp({
      PROMPTSHIELD_API_KEYS: "some-other-key",
      PROMPTSHIELD_KEY_POLICIES: JSON.stringify({ "policy-only-key": { default: "block" } }),
    });
    const authed = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer policy-only-key" },
      payload: { text: "ssn 123-45-6789" },
    });
    expect(authed.statusCode).toBe(422); // authorized AND its block policy applied

    const noKey = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "hi" },
    });
    expect(noKey.statusCode).toBe(401);
    await app.close();
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-caller budget is spent", async () => {
    const app = buildApp({ PROMPTSHIELD_RATE_LIMIT: "2" });
    const ok1 = await app.inject({ method: "POST", url: "/v1/redact", payload: { text: "hi" } });
    const ok2 = await app.inject({ method: "POST", url: "/v1/redact", payload: { text: "hi" } });
    const limited = await app.inject({ method: "POST", url: "/v1/redact", payload: { text: "hi" } });
    expect(ok1.statusCode).toBe(200);
    expect(ok2.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("rate_limited");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });

  it("budgets each API key separately", async () => {
    const app = buildApp({
      PROMPTSHIELD_API_KEYS: "k1,k2",
      PROMPTSHIELD_RATE_LIMIT: "1",
    });
    const a1 = await app.inject({
      method: "POST", url: "/v1/redact",
      headers: { authorization: "Bearer k1" }, payload: { text: "hi" },
    });
    const a2 = await app.inject({
      method: "POST", url: "/v1/redact",
      headers: { authorization: "Bearer k1" }, payload: { text: "hi" },
    });
    const b1 = await app.inject({
      method: "POST", url: "/v1/redact",
      headers: { authorization: "Bearer k2" }, payload: { text: "hi" },
    });
    expect(a1.statusCode).toBe(200);
    expect(a2.statusCode).toBe(429); // k1 exhausted
    expect(b1.statusCode).toBe(200); // k2 has its own budget
    await app.close();
  });

  it("never rate-limits public routes", async () => {
    const app = buildApp({ PROMPTSHIELD_RATE_LIMIT: "1" });
    await app.inject({ method: "GET", url: "/health" });
    const h = await app.inject({ method: "GET", url: "/health" });
    const m = await app.inject({ method: "GET", url: "/metrics" });
    expect(h.statusCode).toBe(200);
    expect(m.statusCode).toBe(200);
    await app.close();
  });
});

describe("auth", () => {
  it("blocks unauthenticated requests when keys are configured", async () => {
    const app = buildApp({ PROMPTSHIELD_API_KEYS: "secret-key-1,secret-key-2" });
    const noKey = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "hi" },
    });
    expect(noKey.statusCode).toBe(401);

    const withKey = await app.inject({
      method: "POST",
      url: "/v1/redact",
      headers: { authorization: "Bearer secret-key-1" },
      payload: { text: "hi" },
    });
    expect(withKey.statusCode).toBe(200);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200); // public route bypasses auth

    await app.close();
  });
});
