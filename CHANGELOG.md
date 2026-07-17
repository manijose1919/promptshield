# Changelog

All notable changes to PromptShield are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
