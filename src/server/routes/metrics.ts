import type { FastifyInstance } from "fastify";
import type { Metrics } from "../metrics.js";

export function registerMetricsRoute(app: FastifyInstance, metrics: Metrics): void {
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return metrics.render();
  });
}
