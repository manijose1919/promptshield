import type { FastifyInstance } from "fastify";
import type { Redactor } from "../../core/redactor.js";
import type { TokenVault } from "../../core/vault.js";
import type { AuditSink } from "../../core/audit.js";
import { summarizeEntities } from "../../core/audit.js";
import type { TokenMap } from "../../core/types.js";
import type { Metrics } from "../metrics.js";

export interface RedactRouteDeps {
  redactor: Redactor;
  vault: TokenVault;
  audit: AuditSink;
  metrics: Metrics;
}

const redactBodySchema = {
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 1_000_000 },
    store_token_map: { type: "boolean", default: false },
  },
} as const;

const rehydrateBodySchema = {
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: {
    text: { type: "string", maxLength: 1_000_000 },
    token_map: {
      type: "object",
      properties: {
        entries: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["entries"],
      additionalProperties: false,
    },
    token_map_id: { type: "string" },
  },
} as const;

export function registerRedactRoutes(
  app: FastifyInstance,
  deps: RedactRouteDeps,
): void {
  const { redactor, vault, audit, metrics } = deps;

  app.post<{ Body: { text: string; store_token_map?: boolean } }>(
    "/v1/redact",
    { schema: { body: redactBodySchema } },
    async (req, reply) => {
      const { text, store_token_map } = req.body;
      const result = redactor.redact(text);

      metrics.recordRequest("/v1/redact");
      metrics.recordRedaction("/v1/redact", result.entities, result.blocked);

      const summary = summarizeEntities(result.entities);
      await audit.record({
        ts: new Date().toISOString(),
        requestId: req.id,
        route: "/v1/redact",
        blocked: result.blocked,
        ...summary,
      });

      // If the policy blocked anything, surface 422 so callers can hard-stop.
      if (result.blocked) {
        return reply.code(422).send({
          error: "blocked",
          message: "Request contains entity types configured to block.",
          entities: result.entities.map(stripRaw),
        });
      }

      const tokenMapId = store_token_map ? vault.store(result.tokenMap) : undefined;
      return reply.send({
        redacted: result.redacted,
        entities: result.entities.map(stripRaw),
        token_map: result.tokenMap,
        token_map_id: tokenMapId,
        blocked: false,
      });
    },
  );

  app.post<{
    Body: { text: string; token_map?: TokenMap; token_map_id?: string };
  }>(
    "/v1/rehydrate",
    { schema: { body: rehydrateBodySchema } },
    async (req, reply) => {
      const { text, token_map, token_map_id } = req.body;

      let map: TokenMap | undefined = token_map;
      if (!map && token_map_id) map = vault.get(token_map_id);
      if (!map) {
        return reply.code(400).send({
          error: "missing_token_map",
          message:
            "Provide either token_map or a valid (unexpired) token_map_id.",
        });
      }

      return reply.send({ text: redactor.rehydrate(text, map) });
    },
  );
}

/** Never echo raw offsets that could aid reconstruction beyond what's needed. */
function stripRaw(e: {
  type: string;
  label: string;
  placeholder: string;
  action: string;
}): { type: string; label: string; placeholder: string; action: string } {
  return {
    type: e.type,
    label: e.label,
    placeholder: e.placeholder,
    action: e.action,
  };
}
