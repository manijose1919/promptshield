import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time lookup returning the MATCHED key (or undefined). A naive
 * `keys.includes(candidate)` leaks timing about how many leading characters
 * matched; we compare every configured key with timingSafeEqual and never
 * short-circuit, so timing stays independent of match position. Returning the
 * matched key (which the client already sent) enables per-key policy without
 * weakening this guarantee.
 */
function matchKey(candidate: string, keys: string[]): string | undefined {
  const cand = Buffer.from(candidate);
  let matched: string | undefined;
  // timingSafeEqual throws on length mismatch, so a naive skip-on-unequal-length
  // leaks whether the candidate's length matched a configured key. Always do a
  // same-length compare (real key or a padded copy) and never short-circuit.
  for (const key of keys) {
    const k = Buffer.from(key);
    if (k.length === cand.length) {
      if (timingSafeEqual(k, cand)) matched = key;
    } else {
      const padded = Buffer.alloc(cand.length);
      k.copy(padded, 0, 0, Math.min(k.length, cand.length));
      timingSafeEqual(padded, cand);
    }
  }
  return matched;
}

/**
 * Registers an onRequest hook enforcing API-key auth for non-public routes.
 * If `apiKeys` is empty, auth is DISABLED (development convenience) and a loud
 * warning is logged so this can never be mistaken for a secure default.
 */
export function registerAuth(app: FastifyInstance, apiKeys: string[]): void {
  const publicRoutes = new Set(["/health", "/v1/health", "/metrics"]);

  if (apiKeys.length === 0) {
    app.log.warn(
      "PROMPTSHIELD_API_KEYS is empty — API authentication is DISABLED. Do not run like this in production.",
    );
  }

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (apiKeys.length === 0) return; // auth disabled
    if (publicRoutes.has(req.url.split("?")[0] ?? req.url)) return;

    const header = req.headers["authorization"];
    const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
    const apiKeyHeader = req.headers["x-api-key"];
    const candidate =
      token || (typeof apiKeyHeader === "string" ? apiKeyHeader : "");

    const matched = candidate ? matchKey(candidate, apiKeys) : undefined;
    if (!matched) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid API key." });
    }
    // Expose the authenticated key so routes can apply its per-key policy.
    req.promptshieldApiKey = matched;
  });
}

declare module "fastify" {
  interface FastifyRequest {
    /** The API key this request authenticated with (unset when auth is off). */
    promptshieldApiKey?: string;
  }
}
