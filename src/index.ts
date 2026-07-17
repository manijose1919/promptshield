import { loadConfig } from "./config/env.js";
import { createApp } from "./server/app.js";

/**
 * Standalone entrypoint: load config, build the app, and listen. Graceful
 * shutdown on SIGINT/SIGTERM so in-flight requests drain and the audit file
 * handle is released cleanly (important under Docker/orchestrators).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp(config);

  const close = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("SIGTERM", () => void close("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[PromptShield] fatal startup error:", err);
  process.exit(1);
});
