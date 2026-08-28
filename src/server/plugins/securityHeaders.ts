import type { FastifyInstance } from "fastify";

/**
 * Baseline HTTP security headers. PromptShield is an API, not a document
 * origin, so we can be strict: never frame us, never sniff MIME types, and
 * don't leak the referring URL. HSTS is omitted — it belongs on the TLS
 * terminator in front of this process, not on a server that may still be
 * reached over plain HTTP in local/dev Docker.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-dns-prefetch-control", "off");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=()",
    );
  });
}
