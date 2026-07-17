import { describe, it, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

/**
 * Build an app whose upstream is a fake fetch. The fake captures the request
 * body it received so we can assert the outbound prompt was redacted, and it
 * replies with a placeholder in its content so we can assert rehydration.
 */
function buildProxyApp(opts: {
  captured?: { body?: any };
  responseContent?: string;
  status?: number;
  rehydrate?: boolean;
}): FastifyInstance {
  const config = loadConfig({
    LOG_LEVEL: "silent",
    AUDIT_SINK: "none",
    UPSTREAM_API_KEY: "upstream-secret",
    UPSTREAM_BASE_URL: "https://fake.upstream/v1",
    REHYDRATE_RESPONSES: opts.rehydrate === false ? "false" : "true",
  });

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    if (opts.captured) opts.captured.body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        choices: [
          { index: 0, message: { role: "assistant", content: opts.responseContent ?? "ok" } },
        ],
      }),
      { status: opts.status ?? 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  return createApp(config, { fetchImpl });
}

describe("POST /v1/chat/completions (proxy)", () => {
  it("redacts outbound messages before they reach upstream", async () => {
    const captured: { body?: any } = {};
    const app = buildProxyApp({ captured });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You help user jane@acme.com" },
          { role: "user", content: "My email is jane@acme.com, help me" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    // Upstream must have seen NO raw email, and a consistent placeholder.
    const sent = JSON.stringify(captured.body);
    expect(sent).not.toContain("jane@acme.com");
    expect(sent).toContain("[EMAIL_1]");
    await app.close();
  });

  it("rehydrates placeholders in the model reply", async () => {
    const app = buildProxyApp({
      responseContent: "I emailed [EMAIL_1] for you.",
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "contact bob@x.io" }],
      },
    });
    expect(res.json().choices[0].message.content).toBe(
      "I emailed bob@x.io for you.",
    );
    await app.close();
  });

  it("does NOT rehydrate when disabled", async () => {
    const app = buildProxyApp({
      responseContent: "sent to [EMAIL_1]",
      rehydrate: false,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "bob@x.io" }] },
    });
    expect(res.json().choices[0].message.content).toBe("sent to [EMAIL_1]");
    await app.close();
  });

  it("rejects streaming requests with 400", async () => {
    const app = buildProxyApp({});
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("streaming_unsupported");
    await app.close();
  });

  it("returns 500 when upstream key is unset", async () => {
    const config = loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none" });
    const app = createApp(config, {
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("upstream_not_configured");
    await app.close();
  });
});
