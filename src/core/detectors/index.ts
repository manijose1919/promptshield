import type { Detector } from "../types.js";
import { emailDetector } from "./email.js";
import { phoneDetector } from "./phone.js";
import { creditCardDetector } from "./creditCard.js";
import { ssnDetector } from "./ssn.js";
import { ipv4Detector, ipv6Detector } from "./ip.js";
import { jwtDetector, apiKeyDetector } from "./secrets.js";
import { dateDetector } from "./date.js";
import { addressDetector } from "./address.js";
import { nameDetector } from "./name.js";

/**
 * The default detector registry. Order is not significant for correctness —
 * overlap resolution happens in the redactor — but higher-signal detectors are
 * listed first for readability. Add a new PII type by appending here.
 */
export const defaultDetectors: Detector[] = [
  emailDetector,
  creditCardDetector,
  ssnDetector,
  phoneDetector,
  jwtDetector,
  apiKeyDetector,
  ipv4Detector,
  ipv6Detector,
  dateDetector,
  addressDetector,
  nameDetector,
];

export {
  emailDetector,
  phoneDetector,
  creditCardDetector,
  ssnDetector,
  ipv4Detector,
  ipv6Detector,
  jwtDetector,
  apiKeyDetector,
  dateDetector,
  addressDetector,
  nameDetector,
};
