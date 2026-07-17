import type { FastifyInstance } from "fastify";
import type { Redactor } from "../../core/redactor.js";
import type { AuditSink } from "../../core/audit.js";
import { summarizeEntities } from "../../core/audit.js";
import type { TokenMap } from "../../core/types.js";
import type { Metrics } from "../metrics.js";

export interface ProxyRouteDeps {
  redactor: Redactor;
  audit: AuditSink;
  metrics: Metrics;
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

    if (body.stream) {
      return reply.code(400).send({
        error: "streaming_unsupported",
        message:
          "Streaming responses are not yet supported by the redaction proxy. Set stream:false.",
      });
    }
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

    const { redacted, tokenMap, blocked, entities } =
      deps.redactor.redactBatch(texts);

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

/** Walk an OpenAI chat-completion response and rehydrate message contents. */
function rehydratePayload(
  payload: unknown,
  tokenMap: TokenMap,
  redactor: Redactor,
): void {
  if (typeof payload !== "object" || payload === null) return;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    const message = (choice as { message?: { content?: unknown } }).message;
    if (message && typeof message.content === "string") {
      message.content = redactor.rehydrate(message.content, tokenMap);
    }
  }
}
