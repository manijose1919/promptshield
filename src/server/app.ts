import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { Redactor } from "../core/redactor.js";
import type { AsyncDetector } from "../core/types.js";
import { defaultDetectors } from "../core/detectors/index.js";
import { buildCustomDetectors } from "../core/detectors/custom.js";
import { PolicyEngine } from "../core/policy.js";
import { createAuditSink, type AuditSink } from "../core/audit.js";
import { InMemoryTokenVault, type TokenVault } from "../core/vault.js";
import { registerAuth } from "./plugins/auth.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { registerSecurityHeaders } from "./plugins/securityHeaders.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerRedactRoutes } from "./routes/redact.js";
import { registerProxyRoutes } from "./routes/proxy.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { Metrics } from "./metrics.js";

export interface AppOverrides {
  redactor?: Redactor;
  vault?: TokenVault;
  audit?: AuditSink;
  /**
   * Model-backed detectors (e.g. an NER service) consulted on the async path.
   * Wired into the default Redactor unless a `redactor` override is supplied.
   */
  asyncDetectors?: AsyncDetector[];
  /** Injectable fetch for the proxy route (added in Layer 4) and tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Build a fully-wired Fastify instance WITHOUT starting it. This is the single
 * seam that makes PromptShield usable three ways: as a standalone server
 * (index.ts calls .listen()), embedded in another Fastify app (register these
 * routes), and in tests (app.inject() with no network). Nothing here has a
 * side effect beyond constructing the instance.
 */
export function createApp(
  config: AppConfig,
  overrides: AppOverrides = {},
): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.trustProxy,
  });

  const policy = new PolicyEngine({ defaultAction: config.defaultAction });
  const detectors = [
    ...defaultDetectors,
    ...buildCustomDetectors(config.customRules),
  ];
  const redactor =
    overrides.redactor ??
    new Redactor({
      detectors,
      asyncDetectors: overrides.asyncDetectors,
      resolveAction: policy.resolver(),
    });
  const vault = overrides.vault ?? new InMemoryTokenVault();
  const audit =
    overrides.audit ?? createAuditSink(config.auditSink, config.auditFile);

  const metrics = new Metrics();

  // Keys named only in the per-key policy map are still valid credentials, so
  // integrators don't have to list every key twice.
  const authKeys = Array.from(
    new Set([...config.apiKeys, ...Object.keys(config.keyPolicies)]),
  );

  registerSecurityHeaders(app);
  registerAuth(app, authKeys);
  registerRateLimit(app, {
    limit: config.rateLimit,
    windowSec: config.rateWindowSec,
    metrics,
  });
  registerHealthRoutes(app);
  registerMetricsRoute(app, metrics);
  registerRedactRoutes(app, {
    redactor,
    vault,
    audit,
    metrics,
    policy,
    keyPolicies: config.keyPolicies,
  });
  registerProxyRoutes(app, {
    redactor,
    audit,
    metrics,
    policy,
    keyPolicies: config.keyPolicies,
    fetchImpl: overrides.fetchImpl ?? fetch,
    upstreamBaseUrl: config.upstreamBaseUrl,
    upstreamApiKey: config.upstreamApiKey,
    rehydrateResponses: config.rehydrateResponses,
  });

  // Expose wired dependencies so later layers (proxy) and tests can reach them.
  app.decorate("promptshield", { config, redactor, vault, audit, policy, metrics });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    promptshield: {
      config: AppConfig;
      redactor: Redactor;
      vault: TokenVault;
      audit: AuditSink;
      policy: PolicyEngine;
      metrics: Metrics;
    };
  }
}
