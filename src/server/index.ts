export { createApp } from "./app.js";
export type { AppOverrides } from "./app.js";
// Re-exported for ergonomic wiring of a shared vault via createApp overrides.
export {
  InMemoryTokenVault,
  KeyValueTokenVault,
} from "../core/vault.js";
export type { TokenVault, AsyncKeyValueStore } from "../core/vault.js";
