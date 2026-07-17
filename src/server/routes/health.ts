import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  const handler = async () => ({
    status: "ok",
    service: "promptshield",
    time: new Date().toISOString(),
  });
  app.get("/health", handler);
  app.get("/v1/health", handler);
}
