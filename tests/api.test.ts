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
    const { redacted, token_map_id } = redactRes.json();
    expect(token_map_id).toBeTruthy();

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
