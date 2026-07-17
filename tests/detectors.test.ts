import { describe, it, expect } from "vitest";
import {
  emailDetector,
  phoneDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  jwtDetector,
  apiKeyDetector,
} from "../src/core/detectors/index.js";
import { creditCardDetector, luhnValid } from "../src/core/detectors/creditCard.js";

describe("emailDetector", () => {
  it("finds a basic email", () => {
    const m = emailDetector.detect("ping jane.doe@acme.co.uk now");
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe("jane.doe@acme.co.uk");
  });
  it("returns nothing when absent", () => {
    expect(emailDetector.detect("no addresses here")).toHaveLength(0);
  });
});

describe("phoneDetector", () => {
  it.each([
    "415-555-0132",
    "(415) 555-0132",
    "+1 415 555 0132",
    "415.555.0132",
  ])("detects %s", (num) => {
    const m = phoneDetector.detect(`call ${num} please`);
    expect(m.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ssnDetector", () => {
  it("detects a dashed SSN", () => {
    expect(ssnDetector.detect("ssn 123-45-6789")).toHaveLength(1);
  });
  it("rejects invalid area 000", () => {
    expect(ssnDetector.detect("000-12-3456")).toHaveLength(0);
  });
});

describe("creditCardDetector + luhn", () => {
  it("accepts a Luhn-valid Visa test number", () => {
    // 4111 1111 1111 1111 is the canonical Visa test PAN (passes Luhn).
    const m = creditCardDetector.detect("card 4111 1111 1111 1111 ok");
    expect(m).toHaveLength(1);
  });
  it("rejects a Luhn-invalid 16-digit run", () => {
    expect(creditCardDetector.detect("id 1234 5678 9012 3456")).toHaveLength(0);
  });
  it("luhnValid guards length", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("123")).toBe(false);
    expect(luhnValid("4111a11111111111")).toBe(false);
  });
});

describe("ip detectors", () => {
  it("detects IPv4", () => {
    expect(ipv4Detector.detect("host 192.168.1.10")).toHaveLength(1);
  });
  it("does not detect out-of-range IPv4", () => {
    expect(ipv4Detector.detect("999.999.999.999")).toHaveLength(0);
  });
  it("detects a full IPv6", () => {
    expect(
      ipv6Detector.detect("addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
    ).toHaveLength(1);
  });
  it("detects compressed IPv6", () => {
    expect(ipv6Detector.detect("addr 2001:db8::8a2e:370:7334")).toHaveLength(1);
  });
});

describe("secret detectors", () => {
  it("detects a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";
    expect(jwtDetector.detect(`token ${jwt}`)).toHaveLength(1);
  });
  it("detects an OpenAI-style key", () => {
    expect(
      apiKeyDetector.detect("key sk-abcdefghijklmnopqrstuvwxyz0123456789"),
    ).toHaveLength(1);
  });
  it("detects an AWS access key id", () => {
    expect(apiKeyDetector.detect("AKIAIOSFODNN7EXAMPLE")).toHaveLength(1);
  });
});
