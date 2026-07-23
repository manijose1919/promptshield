export { createApp } from "./app.js";
export type { AppOverrides } from "./app.js";
// Re-exported for ergonomic wiring of a shared vault via createApp overrides.
export {
  InMemoryTokenVault,
  KeyValueTokenVault,
} from "../core/vault.js";
export type { TokenVault, AsyncKeyValueStore } from "../core/vault.js";
// Re-exported so the async NER seam can be wired via createApp({ asyncDetectors })
// from the same entry point (matches the README integration example).
export { createHttpNerDetector } from "../core/detectors/ner.js";
export type { HttpNerOptions } from "../core/detectors/ner.js";
export type { AsyncDetector } from "../core/types.js";
