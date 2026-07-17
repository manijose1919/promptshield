import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";
import { PromptShieldClient, PromptShieldError } from "../src/sdk/client.js";
import { Redactor } from "../src/core/redactor.js";

/** Bridge the SDK's fetch to Fastify's inject() so we exercise the real app. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const res = await app.inject({
      method: (init.method as any) ?? "GET",
      url: new URL(url).pathname,
      headers: init.headers as any,
      payload: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(res.body, {
      status: res.statusCode,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function build(): { app: FastifyInstance; client: PromptShieldClient } {
  const app = createApp(loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none" }));
  const client = new PromptShieldClient({
    baseUrl: "http://local.test",
    fetchImpl: injectFetch(app),
  });
  return { app, client };
}

describe("PromptShieldClient", () => {
  it("redacts and rehydrates round-trip via the API", async () => {
    const { app, client } = build();
    const r = await client.redact("email jane@acme.com");
    expect(r.redacted).toBe("email [EMAIL_1]");

    const back = await client.rehydrate(r.redacted, { tokenMap: r.token_map });
    expect(back.text).toBe("email jane@acme.com");
    await app.close();
  });

  it("supports stored token map ids", async () => {
    const { app, client } = build();
    const r = await client.redact("call 415-555-0132", { storeTokenMap: true });
    expect(r.token_map_id).toBeTruthy();
    const back = await client.rehydrate(r.redacted, { tokenMapId: r.token_map_id });
    expect(back.text).toBe("call 415-555-0132");
    await app.close();
  });

  it("throws PromptShieldError on 401", async () => {
    const app = createApp(
      loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none", PROMPTSHIELD_API_KEYS: "k1" }),
    );
    const client = new PromptShieldClient({
      baseUrl: "http://local.test",
      fetchImpl: injectFetch(app),
    });
    await expect(client.redact("x")).rejects.toBeInstanceOf(PromptShieldError);
    await app.close();
  });
});

describe("Redactor.redactBatch", () => {
  it("keeps placeholders consistent across strings", () => {
    const r = new Redactor();
    const out = r.redactBatch(["mail a@b.com", "again a@b.com and c@d.com"]);
    expect(out.redacted[0]).toBe("mail [EMAIL_1]");
    expect(out.redacted[1]).toBe("again [EMAIL_1] and [EMAIL_2]");
    expect(Object.keys(out.tokenMap.entries).sort()).toEqual([
      "[EMAIL_1]",
      "[EMAIL_2]",
    ]);
  });
});
