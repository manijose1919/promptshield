import { z } from "zod";
import type { CustomRuleSpec } from "../core/detectors/custom.js";
import type { ScopedPolicy } from "../core/policy.js";

const CustomRuleSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().optional(),
  flags: z.string().optional(),
  terms: z.array(z.string().min(1)).optional(),
});

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

  DEFAULT_ACTION: z.enum(["redact", "mask", "block", "allow"]).default("redact"),

  /** Max requests per caller (API key, else client IP) per window. 0 = off. */
  PROMPTSHIELD_RATE_LIMIT: z.coerce.number().int().nonnegative().default(0),
  /** Rate-limit window length, in seconds. */
  PROMPTSHIELD_RATE_WINDOW_SEC: z.coerce.number().int().positive().default(60),

  AUDIT_SINK: z.enum(["none", "stdout", "file"]).default("file"),
  AUDIT_FILE: z.string().default("./data/audit.jsonl"),

  UPSTREAM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  UPSTREAM_API_KEY: z.string().default(""),
  REHYDRATE_RESPONSES: boolish.default("true"),

  /** JSON array of custom rules, e.g. [{"name":"employee id","pattern":"EMP-\\d{5}"}] */
  PROMPTSHIELD_CUSTOM_RULES: z.string().default(""),

  /** JSON object mapping an API key to its policy, e.g.
   *  {"tenant-a-key":{"default":"block"},"tenant-b-key":{"overrides":{"EMAIL":"mask"}}}
   *  Keys named here are also accepted as valid auth keys. */
  PROMPTSHIELD_KEY_POLICIES: z.string().default(""),
});

const ActionEnum = z.enum(["redact", "mask", "block", "allow"]);
const ScopedPolicySchema = z.object({
  default: ActionEnum.optional(),
  overrides: z.record(z.string(), ActionEnum).optional(),
});
const KeyPoliciesSchema = z.record(z.string().min(1), ScopedPolicySchema);

/** Parse and validate the per-API-key policy map. Fails fast on bad config. */
function parseKeyPolicies(raw: string): Record<string, ScopedPolicy> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("PROMPTSHIELD_KEY_POLICIES is not valid JSON.");
  }
  return KeyPoliciesSchema.parse(json) as Record<string, ScopedPolicy>;
}

/** Parse and validate the custom-rules JSON blob. Fails fast on bad config. */
function parseCustomRules(raw: string): CustomRuleSpec[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("PROMPTSHIELD_CUSTOM_RULES is not valid JSON.");
  }
  return z.array(CustomRuleSchema).parse(json);
}

export type AppConfig = {
  port: number;
  host: string;
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
  apiKeys: string[];
  defaultAction: "redact" | "mask" | "block" | "allow";
  auditSink: "none" | "stdout" | "file";
  auditFile: string;
  rateLimit: number;
  rateWindowSec: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  rehydrateResponses: boolean;
  customRules: CustomRuleSpec[];
  keyPolicies: Record<string, ScopedPolicy>;
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
    rateLimit: parsed.PROMPTSHIELD_RATE_LIMIT,
    rateWindowSec: parsed.PROMPTSHIELD_RATE_WINDOW_SEC,
    upstreamBaseUrl: parsed.UPSTREAM_BASE_URL.replace(/\/+$/, ""),
    upstreamApiKey: parsed.UPSTREAM_API_KEY,
    rehydrateResponses: parsed.REHYDRATE_RESPONSES,
    customRules: parseCustomRules(parsed.PROMPTSHIELD_CUSTOM_RULES),
    keyPolicies: parseKeyPolicies(parsed.PROMPTSHIELD_KEY_POLICIES),
  };
}
