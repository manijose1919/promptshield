# Changelog

All notable changes to PromptShield are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — Phase 3 features

### Changed
- **Proxy rehydration** now also restores placeholders inside multi-part
  (array) message content and tool/function call `arguments` — not just string
  content. Closes a silent gap for agentic / function-calling callers.
- **`POST /v1/redact` no longer echoes the raw `token_map` inline when
  `store_token_map` is set.** The vault path returns an opaque `token_map_id`
  only; the stateless path (default) still returns the inline map the caller
  needs. Raw PII is never returned on the wire when the vault already holds it.

### Added
- **Async NER seam**: `AsyncDetector` interface + `Redactor.redactAsync` /
  `redactBatchAsync`, wired through `createApp({ asyncDetectors })` and the HTTP
  routes. Ships `createHttpNerDetector` — a reference adapter over any HTTP NER
  service — with fail-open/fail-closed handling and span-bounds guarding. Adds
  open-vocabulary detection (bare names) with no dependency in core; the sync
  `redact()` path is unchanged and pays no latency.
- **Heuristic detectors** for three high-value HIPAA/GDPR identifiers that
  regex-exact detectors miss: `DATE` (incl. DOB — numeric/ISO/month-name forms,
  not bare years), `ADDRESS` (US street addresses), and `NAME` (person names,
  detected only when cued by an honorific or an introduction like "my name
  is …"). All maskable (full-mask, no partial reveal) and policy-configurable.
- **Streaming proxy support** (`stream: true`). The proxy now relays the
  upstream SSE stream and rehydrates placeholders in `delta.content` and
  streamed tool-call `arguments` — correctly buffering placeholders split
  across chunk boundaries via the new pure `StreamRehydrator`. Previously
  streaming was rejected with a 400.
- **`KeyValueTokenVault`** + async `TokenVault` interface, so `token_map_id`
  resolves across a horizontally-scaled deployment. Backs onto any
  `AsyncKeyValueStore` (a ~6-line `node-redis`/`ioredis` adapter) — no new
  dependency in core. `InMemoryTokenVault` remains the default.
- **Custom detection rules** from `PROMPTSHIELD_CUSTOM_RULES` (regex or literal
  terms), validated at startup, rendered with named placeholders.
- **`mask` action**: non-reversible partial masking (keep-last-4 for cards /
  phones / SSN, domain-preserving for email).
- **Prometheus `/metrics`** endpoint (public): request, entity, and block
  counters, hand-rolled exposition format (no new dependency).
- **Per-request policy overrides** on `POST /v1/redact` via a `policy` object
  with clear precedence over server defaults.

## [0.1.0] — Initial build

### Added
- **Detection core**: modular detectors (email, phone, credit-card w/ Luhn, SSN,
  IPv4/IPv6, JWT, API keys), reversible tokenizer, overlap-resolving redactor.
- **Policy engine**: per-entity-type `redact` / `block` / `allow` actions.
- **Privacy-preserving audit**: JSONL / stdout / none sinks that record entity
  types and counts but never raw values.
- **Token vault**: in-memory, TTL-bounded store for `token_map_id` rehydration.
- **HTTP API**: `POST /v1/redact`, `POST /v1/rehydrate`, health endpoints, and
  constant-time API-key auth.
- **OpenAI-compatible proxy**: `POST /v1/chat/completions` — transparent
  redaction outbound and rehydration inbound via a `baseURL` swap.
- **SDK**: typed, dependency-free `PromptShieldClient`.
- **Ops**: Dockerfile (multi-stage), docker-compose, `run.bat`, and GitHub
  Actions CI (Node 20 & 22 + Docker image build).
