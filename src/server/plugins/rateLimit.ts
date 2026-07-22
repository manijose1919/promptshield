import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { RateLimiter } from "../rateLimiter.js";
import type { Metrics } from "../metrics.js";

export interface RateLimitOptions {
  /** Max requests per caller per window. <= 0 disables the limiter entirely. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  metrics: Metrics;
}

/**
 * Registers a per-caller token-bucket rate limiter as an onRequest hook. MUST be
 * registered AFTER auth so `req.promptshieldApiKey` is set — the limiter keys by
 * the authenticated API key, falling back to the client IP when auth is off.
 * Public routes (health, metrics) are never limited.
 */
export function registerRateLimit(
  app: FastifyInstance,
  { limit, windowSec, metrics }: RateLimitOptions,
): void {
  if (limit <= 0) return; // disabled

  const refillPerMs = limit / (windowSec * 1000);
  const limiter = new RateLimiter(limit, refillPerMs);
  const publicRoutes = new Set(["/health", "/v1/health", "/metrics"]);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0] ?? req.url;
    if (publicRoutes.has(path)) return;

    const key = req.promptshieldApiKey ?? req.ip;
    const result = limiter.take(key);
    if (!result.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      metrics.recordRateLimited(path);
      return reply.code(429).header("retry-after", String(retryAfterSec)).send({
        error: "rate_limited",
        message: "Rate limit exceeded. Slow down and retry later.",
        retry_after: retryAfterSec,
      });
    }
  });
}
