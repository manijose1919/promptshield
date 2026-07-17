import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time membership check. A naive `keys.includes(candidate)` leaks
 * timing information about how many leading characters matched; comparing every
 * configured key with timingSafeEqual keeps auth resistant to timing attacks.
 */
function isAuthorized(candidate: string, keys: string[]): boolean {
  const cand = Buffer.from(candidate);
  let ok = false;
  for (const key of keys) {
    const k = Buffer.from(key);
    // Length must match for timingSafeEqual; compare against same-length buffer.
    if (k.length === cand.length && timingSafeEqual(k, cand)) ok = true;
  }
  return ok;
}

/**
 * Registers an onRequest hook enforcing API-key auth for non-public routes.
 * If `apiKeys` is empty, auth is DISABLED (development convenience) and a loud
 * warning is logged so this can never be mistaken for a secure default.
 */
export function registerAuth(app: FastifyInstance, apiKeys: string[]): void {
  const publicRoutes = new Set(["/health", "/v1/health"]);

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

    if (!candidate || !isAuthorized(candidate, apiKeys)) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid API key." });
    }
  });
}
