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
  responseBody?: unknown;
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
    const body = opts.responseBody ?? {
      id: "chatcmpl-1",
      choices: [
        { index: 0, message: { role: "assistant", content: opts.responseContent ?? "ok" } },
      ],
    };
    return new Response(JSON.stringify(body), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
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

  it("rehydrates placeholders inside tool call arguments", async () => {
    const app = buildProxyApp({
      responseBody: {
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: '{"to":"[EMAIL_1]","subject":"hi"}',
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "email bob@x.io" }],
      },
    });
    const args =
      res.json().choices[0].message.tool_calls[0].function.arguments;
    expect(args).toBe('{"to":"bob@x.io","subject":"hi"}');
    await app.close();
  });

  it("rehydrates placeholders in array-style message content parts", async () => {
    const app = buildProxyApp({
      responseBody: {
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "I emailed [EMAIL_1]" },
                { type: "text", text: "and cc'd [EMAIL_1]" },
              ],
            },
          },
        ],
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "contact bob@x.io" }],
      },
    });
    const parts = res.json().choices[0].message.content;
    expect(parts[0].text).toBe("I emailed bob@x.io");
    expect(parts[1].text).toBe("and cc'd bob@x.io");
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
