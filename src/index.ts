import { loadConfig } from "./config/env.js";

/**
 * Standalone entrypoint. Layer 1 bootstrap: validates configuration and
 * confirms the process is wired correctly. The full HTTP server (app factory,
 * routes) is introduced in later layers and wired in here.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  // eslint-disable-next-line no-console
  console.log(
    `[PromptShield] config OK — will listen on ${config.host}:${config.port} ` +
      `(default action: ${config.defaultAction}, audit: ${config.auditSink})`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[PromptShield] fatal startup error:", err);
  process.exit(1);
});
