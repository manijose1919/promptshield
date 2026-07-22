import { describe, it, expect } from "vitest";
import { maskValue } from "../src/core/mask.js";
import { Redactor } from "../src/core/redactor.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/config/env.js";

describe("maskValue", () => {
  it("keeps last 4 of a credit card, preserving separators", () => {
    expect(maskValue("CREDIT_CARD", "4111 1111 1111 1111")).toBe(
      "**** **** **** 1111",
    );
  });
  it("keeps last 4 of a phone", () => {
    expect(maskValue("PHONE", "415-555-0132")).toBe("***-***-0132");
  });
  it("masks SSN to last 4", () => {
    expect(maskValue("SSN", "123-45-6789")).toBe("***-**-6789");
  });
  it("keeps email domain and first char", () => {
    expect(maskValue("EMAIL", "jane@acme.com")).toBe("j***@acme.com");
  });
  it("fully masks heuristic identifiers (name/address/date)", () => {
    expect(maskValue("NAME", "Alice Chen")).toBe("***** ****");
    expect(maskValue("DATE", "03/14/1990")).toBe("**/**/****");
    expect(maskValue("ADDRESS", "123 Main St")).toBe("*** **** **");
  });
});

describe("Redactor with mask action", () => {
  it("masks instead of tokenizing and does NOT populate the token map", () => {
    const r = new Redactor({ resolveAction: () => "mask" });
    const res = r.redact("card 4111 1111 1111 1111");
    expect(res.redacted).toBe("card **** **** **** 1111");
    expect(res.entities[0]!.action).toBe("mask");
    // Masking is irreversible: nothing to rehydrate.
    expect(Object.keys(res.tokenMap.entries)).toHaveLength(0);
  });

  it("mixed policy: mask emails, redact phones", () => {
    const r = new Redactor({
      resolveAction: (t) => (t === "EMAIL" ? "mask" : "redact"),
    });
    const res = r.redact("jane@acme.com / 415-555-0132");
    expect(res.redacted).toBe("j***@acme.com / [PHONE_1]");
  });
});

describe("mask via config + API", () => {
  it("applies DEFAULT_ACTION=mask end to end", async () => {
    const app = createApp(
      loadConfig({ LOG_LEVEL: "silent", AUDIT_SINK: "none", DEFAULT_ACTION: "mask" }),
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/redact",
      payload: { text: "reach jane@acme.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().redacted).toBe("reach j***@acme.com");
    await app.close();
  });
});
