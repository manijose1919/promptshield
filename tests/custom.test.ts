import { describe, it, expect } from "vitest";
import { createCustomDetector } from "../src/core/detectors/custom.js";
import { Redactor } from "../src/core/redactor.js";
import { defaultDetectors } from "../src/core/detectors/index.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

describe("createCustomDetector", () => {
  it("matches a regex pattern rule", () => {
    const d = createCustomDetector({ name: "employee id", pattern: "EMP-\\d{5}" });
    const m = d.detect("user EMP-12345 logged in");
    expect(m).toHaveLength(1);
    expect(m[0]!.label).toBe("employee id");
    expect(m[0]!.type).toBe("CUSTOM");
  });

  it("matches literal terms whole-word, case-insensitively", () => {
    const d = createCustomDetector({
      name: "codename",
      terms: ["Project Titan", "Bluebird"],
      flags: "i",
    });
    expect(d.detect("ship project titan next week")).toHaveLength(1);
    expect(d.detect("the bluebirds are separate")).toHaveLength(0); // whole-word
  });

  it("throws on a rule with neither pattern nor terms", () => {
    expect(() => createCustomDetector({ name: "bad" })).toThrow(/pattern.*terms/);
  });

  it("throws on an invalid regex", () => {
    expect(() => createCustomDetector({ name: "oops", pattern: "(" })).toThrow(
      /invalid regex/,
    );
  });
});

describe("Redactor with custom detectors", () => {
  it("renders custom placeholders using the rule name as label", () => {
    const custom = createCustomDetector({ name: "employee id", pattern: "EMP-\\d{5}" });
    const r = new Redactor({ detectors: [...defaultDetectors, custom] });
    const res = r.redact("EMP-12345 emailed jane@acme.com");
    expect(res.redacted).toBe("[EMPLOYEE_ID_1] emailed [EMAIL_1]");
    expect(r.rehydrate(res.redacted, res.tokenMap)).toBe(
      "EMP-12345 emailed jane@acme.com",
    );
  });
});

describe("custom rules via config + API", () => {
  it("redacts a config-defined rule end to end", async () => {
    const config = loadConfig({
      LOG_LEVEL: "silent",
      AUDIT_SINK: "none",
      PROMPTSHIELD_CUSTOM_RULES: JSON.stringify([
        { name: "employee id", pattern: "EMP-\\d{5}" },
      ]),
    });
    const app = createApp(config);
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "EMP-98765 needs access" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.redacted).toBe("[EMPLOYEE_ID_1] needs access");
    expect(body.entities[0]).toMatchObject({ type: "CUSTOM", label: "employee id" });
    await app.close();
  });

  it("rejects malformed custom-rules JSON at config load", () => {
    expect(() =>
      loadConfig({ PROMPTSHIELD_CUSTOM_RULES: "{not json" }),
    ).toThrow(/not valid JSON/);
  });
});
