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
import { dateDetector } from "../src/core/detectors/date.js";
import { addressDetector } from "../src/core/detectors/address.js";
import { nameDetector } from "../src/core/detectors/name.js";

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

describe("dateDetector", () => {
  it.each([
    "03/14/1990",
    "3-14-90",
    "1990-03-14",
    "March 14, 1990",
    "14 March 1990",
    "Mar 14 1990",
  ])("detects %s", (d) => {
    const m = dateDetector.detect(`born ${d} in town`);
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m[0]!.type).toBe("DATE");
  });

  it("does not match a bare 4-digit year", () => {
    expect(dateDetector.detect("since 1990 we grew")).toHaveLength(0);
  });

  it("does not match an SSN or phone shape", () => {
    expect(dateDetector.detect("ssn 123-45-6789")).toHaveLength(0);
    expect(dateDetector.detect("call 415-555-0132")).toHaveLength(0);
  });
});

describe("addressDetector", () => {
  it("detects a simple street address", () => {
    const m = addressDetector.detect("ship to 123 Main St please");
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe("123 Main St");
  });

  it("detects an address with a unit", () => {
    const m = addressDetector.detect("742 Evergreen Terrace, Apt 4B");
    expect(m).toHaveLength(1);
    expect(m[0]!.value.startsWith("742 Evergreen Terrace")).toBe(true);
  });

  it("ignores a number with no street suffix", () => {
    expect(addressDetector.detect("give me 5 apples")).toHaveLength(0);
  });
});

describe("nameDetector", () => {
  it("detects an honorific + name", () => {
    const m = nameDetector.detect("please contact Dr. Alice Chen today");
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe("Dr. Alice Chen");
  });

  it("detects a name introduced by a cue, capturing only the name", () => {
    const m = nameDetector.detect("Hi, my name is Bob Lee and I need help");
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe("Bob Lee");
  });

  it("detects a first name after I'm", () => {
    const m = nameDetector.detect("I'm Sarah, nice to meet you");
    expect(m[0]!.value).toBe("Sarah");
  });

  it("returns nothing when there is no name cue", () => {
    expect(nameDetector.detect("the meeting is today at noon")).toHaveLength(0);
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
