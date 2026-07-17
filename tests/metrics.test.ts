import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { Metrics } from "../src/server/metrics.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

describe("Metrics", () => {
  it("renders counters in Prometheus format", () => {
    const m = new Metrics();
    m.recordRequest("/v1/redact");
    m.recordRequest("/v1/redact");
    m.recordRedaction(
      "/v1/redact",
      [
        { type: "EMAIL", label: "EMAIL", placeholder: "[EMAIL_1]", action: "redact", start: 0, end: 1 },
      ],
      false,
    );
    const out = m.render();
    expect(out).toContain("# TYPE promptshield_requests_total counter");
    expect(out).toContain('promptshield_requests_total{route="/v1/redact"} 2');
    expect(out).toContain('promptshield_entities_total{action="redact",type="EMAIL"} 1');
  });

  it("escapes quotes/backslashes in label values", () => {
    const m = new Metrics();
    m.recordRequest('/weird"\\route');
    expect(m.render()).toContain('route="/weird\\"\\\\route"');
  });
});

describe("GET /metrics", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = createApp(loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none" }));
  });
  afterEach(async () => {
    await app.close();
  });

  it("is public and reflects redaction activity", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "jane@acme.com" },
    });
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("promptshield_requests_total");
    expect(res.body).toContain('type="EMAIL"');
  });

  it("stays public even when auth is enabled", async () => {
    const secured = createApp(
      loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none", PROMPTSHIELD_API_KEYS: "k1" }),
    );
    const res = await secured.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    await secured.close();
  });
});
