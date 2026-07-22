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
  streamChunks?: string[];
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

    if (opts.streamChunks) {
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of opts.streamChunks!) controller.enqueue(enc.encode(c));
          controller.close();
        },
      });
      return new Response(stream, {
        status: opts.status ?? 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

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

/** Reassemble concatenated delta.content from a relayed SSE body. */
function sseContent(body: string): string {
  let out = "";
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]" || payload === "") continue;
    const chunk = JSON.parse(payload);
    for (const ch of chunk.choices ?? []) {
      if (typeof ch.delta?.content === "string") out += ch.delta.content;
    }
  }
  return out;
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

  it("streams and rehydrates a placeholder split across SSE chunks", async () => {
    const captured: { body?: any } = {};
    const app = buildProxyApp({
      captured,
      streamChunks: [
        'data: {"choices":[{"index":0,"delta":{"content":"I emailed [EMA"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"IL_1]"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "email bob@x.io" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    // Outbound request was still redacted and marked stream:true.
    expect(JSON.stringify(captured.body)).not.toContain("bob@x.io");
    expect(captured.body.stream).toBe(true);

    const body = res.body;
    expect(sseContent(body)).toBe("I emailed bob@x.io");
    expect(body).not.toContain("[EMAIL_1]"); // no placeholder leaked to client
    expect(body).toContain("[DONE]"); // terminator preserved
    await app.close();
  });

  it("streams tool-call argument deltas rehydrated across chunks", async () => {
    const app = buildProxyApp({
      streamChunks: [
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"to\\":\\"[EMA"}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"IL_1]\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "email bob@x.io" }],
      },
    });
    // Reassemble streamed tool-call arguments.
    let args = "";
    for (const line of res.body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const p = t.slice(5).trim();
      if (p === "[DONE]" || p === "") continue;
      for (const ch of JSON.parse(p).choices ?? []) {
        for (const tc of ch.delta?.tool_calls ?? []) {
          if (typeof tc.function?.arguments === "string")
            args += tc.function.arguments;
        }
      }
    }
    expect(args).toBe('{"to":"bob@x.io"}');
    await app.close();
  });

  it("passes stream chunks through unchanged when rehydration is disabled", async () => {
    const app = buildProxyApp({
      rehydrate: false,
      streamChunks: [
        'data: {"choices":[{"index":0,"delta":{"content":"to [EMAIL_1]"}}]}\n\n',
        "data: [DONE]\n\n",
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "bob@x.io" }],
      },
    });
    expect(sseContent(res.body)).toBe("to [EMAIL_1]");
    await app.close();
  });

  it("applies the authenticated key's policy (block) to a proxied request", async () => {
    const config = loadConfig({
      LOG_LEVEL: "silent",
      AUDIT_SINK: "none",
      UPSTREAM_API_KEY: "upstream-secret",
      UPSTREAM_BASE_URL: "https://fake.upstream/v1",
      PROMPTSHIELD_API_KEYS: "plain-key",
      PROMPTSHIELD_KEY_POLICIES: JSON.stringify({ "blocker-key": { default: "block" } }),
    });
    const app = createApp(config, {
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer blocker-key" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "ssn 123-45-6789" }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("blocked");
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
