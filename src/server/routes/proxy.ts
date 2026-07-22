import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import type { Redactor } from "../../core/redactor.js";
import type { AuditSink } from "../../core/audit.js";
import { summarizeEntities } from "../../core/audit.js";
import type { TokenMap } from "../../core/types.js";
import { StreamRehydrator } from "../../core/streamRehydrator.js";
import type { PolicyEngine, ScopedPolicy } from "../../core/policy.js";
import type { Metrics } from "../metrics.js";

export interface ProxyRouteDeps {
  redactor: Redactor;
  audit: AuditSink;
  metrics: Metrics;
  policy: PolicyEngine;
  keyPolicies: Record<string, ScopedPolicy>;
  fetchImpl: typeof fetch;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  rehydrateResponses: boolean;
}

interface ChatMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }> | null;
}
interface ChatBody {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  [k: string]: unknown;
}

/**
 * OpenAI-compatible chat proxy. Redacts PII out of every message before it
 * leaves for the upstream provider (whose key we inject server-side), then
 * optionally rehydrates placeholders in the model's reply. This is the
 * "change your baseURL, change nothing else" integration surface.
 */
export function registerProxyRoutes(
  app: FastifyInstance,
  deps: ProxyRouteDeps,
): void {
  app.post<{ Body: ChatBody }>("/v1/chat/completions", async (req, reply) => {
    const body = req.body ?? {};

    if (!Array.isArray(body.messages)) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "`messages` must be an array.",
      });
    }
    if (!deps.upstreamApiKey) {
      return reply.code(500).send({
        error: "upstream_not_configured",
        message: "UPSTREAM_API_KEY is not set on the PromptShield server.",
      });
    }

    // 1. Collect all redactable text with setters to write results back.
    const texts: string[] = [];
    const slots: Array<(v: string) => void> = [];
    for (const msg of body.messages) {
      if (typeof msg.content === "string") {
        texts.push(msg.content);
        slots.push((v) => {
          msg.content = v;
        });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && part.type === "text" && typeof part.text === "string") {
            texts.push(part.text);
            slots.push((v) => {
              part.text = v;
            });
          }
        }
      }
    }

    // Apply the authenticated key's policy (if any) to this proxy request.
    const keyPolicy = req.promptshieldApiKey
      ? deps.keyPolicies[req.promptshieldApiKey]
      : undefined;
    const resolver = keyPolicy
      ? deps.policy.resolverWith(undefined, undefined, keyPolicy)
      : undefined;

    const { redacted, tokenMap, blocked, entities } =
      await deps.redactor.redactBatchAsync(texts, resolver);

    deps.metrics.recordRequest("/v1/chat/completions");
    deps.metrics.recordRedaction("/v1/chat/completions", entities, blocked);

    await deps.audit.record({
      ts: new Date().toISOString(),
      requestId: req.id,
      route: "/v1/chat/completions",
      blocked,
      ...summarizeEntities(entities),
    });

    if (blocked) {
      return reply.code(422).send({
        error: "blocked",
        message: "Prompt contains entity types configured to block.",
      });
    }

    redacted.forEach((v, i) => slots[i]?.(v));

    // 2. Forward the redacted request to the real upstream provider.
    let upstreamRes: Response;
    try {
      upstreamRes = await deps.fetchImpl(
        `${deps.upstreamBaseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deps.upstreamApiKey}`,
          },
          body: JSON.stringify(body),
        },
      );
    } catch (err) {
      req.log.error({ err }, "upstream request failed");
      return reply.code(502).send({
        error: "upstream_unreachable",
        message: "Failed to reach the upstream model provider.",
      });
    }

    // Streaming path: relay the upstream SSE stream, rehydrating placeholders
    // across chunk boundaries as they flow to the client.
    const contentType = upstreamRes.headers.get("content-type") ?? "";
    if (
      body.stream &&
      upstreamRes.body &&
      contentType.includes("text/event-stream")
    ) {
      reply.header("content-type", "text/event-stream");
      reply.header("cache-control", "no-cache");
      reply.header("connection", "keep-alive");
      return reply.send(
        Readable.from(
          relaySse(upstreamRes.body, tokenMap, deps.rehydrateResponses),
        ),
      );
    }

    const text = await upstreamRes.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON upstream response — pass it through verbatim.
      return reply.code(upstreamRes.status).send(text);
    }

    // 3. Optionally rehydrate placeholders in the model's reply.
    if (deps.rehydrateResponses && upstreamRes.ok) {
      rehydratePayload(payload, tokenMap, deps.redactor);
    }

    return reply.code(upstreamRes.status).send(payload);
  });
}

/**
 * Relay an upstream OpenAI SSE stream to the client, rehydrating placeholders
 * in `delta.content` and streamed tool-call `arguments`. Because a placeholder
 * can be split across chunks, each output sequence gets its own
 * {@link StreamRehydrator} that buffers a trailing partial token until it
 * completes. Yields already-framed `data: …\n\n` events.
 */
async function* relaySse(
  upstreamBody: ReadableStream<Uint8Array>,
  tokenMap: TokenMap,
  rehydrateEnabled: boolean,
): AsyncGenerator<string> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();

  // One rehydrator per choice index (content) and per choice:tool-call (args),
  // so independent output streams never share a buffer.
  const contentR = new Map<number, StreamRehydrator>();
  const argsR = new Map<string, StreamRehydrator>();
  const content = (i: number) =>
    contentR.get(i) ?? contentR.set(i, new StreamRehydrator(tokenMap)).get(i)!;
  const argsFor = (k: string) =>
    argsR.get(k) ?? argsR.set(k, new StreamRehydrator(tokenMap)).get(k)!;

  const processLine = (line: string): string | null => {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("data:")) return null;
    const payload = trimmed.slice(5).trim();

    if (payload === "[DONE]") {
      // Flush anything still buffered as synthetic trailing chunks so no
      // rehydrated text is lost if the provider omitted a finish_reason.
      let pre = "";
      if (rehydrateEnabled) {
        for (const [i, r] of contentR) {
          const rest = r.flush();
          if (rest)
            pre += frame({ choices: [{ index: i, delta: { content: rest } }] });
        }
        for (const [k, r] of argsR) {
          const rest = r.flush();
          if (!rest) continue;
          const [i, tci] = k.split(":").map(Number);
          pre += frame({
            choices: [
              {
                index: i,
                delta: {
                  tool_calls: [{ index: tci, function: { arguments: rest } }],
                },
              },
            ],
          });
        }
      }
      return pre + "data: [DONE]\n\n";
    }

    if (!rehydrateEnabled) return `data: ${payload}\n\n`;

    let obj: any;
    try {
      obj = JSON.parse(payload);
    } catch {
      return `data: ${payload}\n\n`; // pass malformed lines through untouched
    }

    for (const ch of obj?.choices ?? []) {
      const index = typeof ch.index === "number" ? ch.index : 0;
      const finished = ch.finish_reason != null;
      const delta = ch.delta;
      if (!delta || typeof delta !== "object") continue;

      if (typeof delta.content === "string") {
        let c = content(index).push(delta.content);
        if (finished) c += content(index).flush();
        delta.content = c;
      } else if (finished) {
        const rest = content(index).flush();
        if (rest) delta.content = rest;
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const tci = typeof tc.index === "number" ? tc.index : 0;
          const fn = tc.function;
          if (fn && typeof fn.arguments === "string") {
            const key = `${index}:${tci}`;
            let a = argsFor(key).push(fn.arguments);
            if (finished) a += argsFor(key).flush();
            fn.arguments = a;
          }
        }
      }
    }
    return `data: ${JSON.stringify(obj)}\n\n`;
  };

  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = raw.indexOf("\n")) !== -1) {
      const out = processLine(raw.slice(0, nl));
      raw = raw.slice(nl + 1);
      if (out !== null) yield out;
    }
  }
  if (raw.length > 0) {
    const out = processLine(raw);
    if (out !== null) yield out;
  }
}

/** Serialize a synthetic chat-completion chunk as one framed SSE event. */
function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Walk an OpenAI chat-completion response and rehydrate every place a model can
 * echo a placeholder: string content, multi-part array content, and the JSON
 * `arguments` string of any tool/function call. Tool-call arguments are the
 * critical case for agentic use — a redacted email the model routes into a
 * `send_email` call must come back as the real address or the tool misfires.
 */
function rehydratePayload(
  payload: unknown,
  tokenMap: TokenMap,
  redactor: Redactor,
): void {
  if (typeof payload !== "object" || payload === null) return;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return;
  const swap = (s: string) => redactor.rehydrate(s, tokenMap);

  for (const choice of choices) {
    const message = (choice as { message?: Record<string, unknown> }).message;
    if (!message || typeof message !== "object") continue;

    // 1. Plain string content.
    if (typeof message.content === "string") {
      message.content = swap(message.content);
    } else if (Array.isArray(message.content)) {
      // 2. Multi-part content: rehydrate each text part.
      for (const part of message.content) {
        if (part && typeof part.text === "string") part.text = swap(part.text);
      }
    }

    // 3. Tool / function call arguments (JSON-encoded strings).
    const toolCalls = message.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const fn = (call as { function?: { arguments?: unknown } }).function;
        if (fn && typeof fn.arguments === "string") {
          fn.arguments = swap(fn.arguments);
        }
      }
    }
  }
}
