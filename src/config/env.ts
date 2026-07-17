import { z } from "zod";

/**
 * Environment schema. Parsed once at startup so misconfiguration fails fast
 * and loudly instead of surfacing as confusing runtime errors later.
 */
const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no", ""]))
  .transform((v) => v === "true" || v === "1" || v === "yes");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  /** Comma-separated client API keys. Empty => auth disabled (dev only). */
  PROMPTSHIELD_API_KEYS: z.string().default(""),

  DEFAULT_ACTION: z.enum(["redact", "block", "allow"]).default("redact"),

  AUDIT_SINK: z.enum(["none", "stdout", "file"]).default("file"),
  AUDIT_FILE: z.string().default("./data/audit.jsonl"),

  UPSTREAM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  UPSTREAM_API_KEY: z.string().default(""),
  REHYDRATE_RESPONSES: boolish.default("true"),
});

export type AppConfig = {
  port: number;
  host: string;
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
  apiKeys: string[];
  defaultAction: "redact" | "block" | "allow";
  auditSink: "none" | "stdout" | "file";
  auditFile: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  rehydrateResponses: boolean;
};

/**
 * Parse and normalize configuration from a raw environment record.
 * Exposed as a function (rather than reading process.env directly) so tests
 * can construct isolated configs without mutating global state.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    apiKeys: parsed.PROMPTSHIELD_API_KEYS.split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
    defaultAction: parsed.DEFAULT_ACTION,
    auditSink: parsed.AUDIT_SINK,
    auditFile: parsed.AUDIT_FILE,
    upstreamBaseUrl: parsed.UPSTREAM_BASE_URL.replace(/\/+$/, ""),
    upstreamApiKey: parsed.UPSTREAM_API_KEY,
    rehydrateResponses: parsed.REHYDRATE_RESPONSES,
  };
}
