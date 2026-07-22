import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { PolicyEngine } from "../src/core/policy.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

describe("PolicyEngine.resolverWith precedence", () => {
  it("request override > request default > server policy", () => {
    const engine = new PolicyEngine({
      defaultAction: "redact",
      overrides: { EMAIL: "block" },
    });
    const resolve = engine.resolverWith("mask", { PHONE: "allow" });
    expect(resolve("PHONE")).toBe("allow"); // request override wins
    expect(resolve("SSN")).toBe("mask"); // request default wins over server
    expect(resolve("EMAIL")).toBe("mask"); // request default beats server override
  });

  it("layers a key policy between request policy and server policy", () => {
    const engine = new PolicyEngine({
      defaultAction: "redact",
      overrides: { SSN: "block" },
    });
    // Key policy: default mask, override PHONE->allow. Request: override EMAIL->block.
    const resolve = engine.resolverWith(undefined, { EMAIL: "block" }, {
      default: "mask",
      overrides: { PHONE: "allow" },
    });
    expect(resolve("EMAIL")).toBe("block"); // request override wins
    expect(resolve("PHONE")).toBe("allow"); // key override beats key/server
    expect(resolve("IPV4")).toBe("mask"); // key default beats server default
    expect(resolve("SSN")).toBe("mask"); // key default beats server override
  });

  it("falls back to server policy when request specifies nothing", () => {
    const engine = new PolicyEngine({
      defaultAction: "redact",
      overrides: { EMAIL: "mask" },
    });
    const resolve = engine.resolverWith(undefined, undefined);
    expect(resolve("EMAIL")).toBe("mask");
    expect(resolve("PHONE")).toBe("redact");
  });
});

describe("POST /v1/redact with per-request policy", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = createApp(loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none" }));
  });
  afterEach(async () => {
    await app.close();
  });

  it("applies per-request overrides", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: {
        text: "jane@acme.com and 415-555-0132",
        policy: { overrides: { EMAIL: "mask" } },
      },
    });
    expect(res.statusCode).toBe(200);
    // Email masked (per request), phone redacted (server default).
    expect(res.json().redacted).toBe("j***@acme.com and [PHONE_1]");
  });

  it("applies a per-request default action", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "jane@acme.com", policy: { default: "allow" } },
    });
    expect(res.json().redacted).toBe("jane@acme.com");
  });

  it("rejects an invalid action in policy via schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "x", policy: { default: "nuke" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("can block per-request, returning 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "jane@acme.com", policy: { overrides: { EMAIL: "block" } } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("blocked");
  });
});
