# 🛡️ PromptShield

**An LLM Prompt Firewall & PII Redaction Gateway.** Scrub sensitive data out of prompts *before* they ever leave your perimeter for a third-party model provider — then optionally rehydrate the answer on the way back.

[![CI](https://github.com/manijose1919/promptshield/actions/workflows/main.yml/badge.svg)](https://github.com/manijose1919/promptshield/actions/workflows/main.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## The niche problem

Nearly every product now sends user data to LLM APIs (OpenAI, Anthropic, Mistral…). Very few redact **personally identifiable information (PII)** before it crosses the network boundary. That's a direct compliance exposure under **GDPR, HIPAA, PCI-DSS, and SOC 2** — customer emails, credit-card numbers, SSNs, phone numbers, API keys, and internal IPs routinely leak into prompt logs held by third parties.

Enterprise DLP suites exist, but they are heavy, expensive, and not designed to sit *inline* on the LLM request path. **PromptShield is the lightweight, self-hostable firewall for that exact wire.**

## What it does

- **Detects** PII with modular, composable detectors (email, phone, credit card w/ Luhn check, SSN, IPv4/IPv6, JWT & API-key patterns, and more).
- **Redacts** matches into stable, reversible placeholders like `[EMAIL_1]`.
- **Rehydrates** placeholders back to the original values when you need them (e.g. on the model's response).
- **Enforces policy** per entity type: `redact`, `block` (reject the request), or `allow`.
- **Audits** every event to a pluggable sink (stdout / JSONL file) — without ever storing the raw PII.

## Three ways to use it (one core)

| Surface | Use it as | Best for |
| --- | --- | --- |
| **Library** | `import { Redactor } from "promptshield/core"` | In-process apps |
| **REST API** | `POST /v1/redact`, `POST /v1/rehydrate` | Any language |
| **OpenAI-compatible proxy** | Point your OpenAI SDK's `baseURL` at PromptShield | **Zero code change** |

---

## 🚀 Quickstart (one step)

**Windows:**
```bat
run.bat
```

**Docker (any OS):**
```bash
docker compose up --build
```

**npm (any OS):**
```bash
npm install && npm run build && npm start
```

Then:
```bash
curl -s http://localhost:8787/v1/redact \
  -H "content-type: application/json" \
  -d '{"text":"Email me at jane.doe@acme.com or call 415-555-0132"}'
```
```json
{
  "redacted": "Email me at [EMAIL_1] or call [PHONE_1]",
  "entities": [
    { "type": "EMAIL", "placeholder": "[EMAIL_1]", "action": "redact" },
    { "type": "PHONE", "placeholder": "[PHONE_1]", "action": "redact" }
  ],
  "token_map": { "entries": { "[EMAIL_1]": "jane.doe@acme.com", "[PHONE_1]": "415-555-0132" } }
}
```

### Two rehydration modes (stateless vs. vaulted)

`POST /v1/redact` returns exactly one of two things so raw PII never travels
back over the wire redundantly:

| Request | Response | Use when |
| --- | --- | --- |
| default | inline `token_map` (holds the originals) | caller rehydrates client-side |
| `"store_token_map": true` | opaque `token_map_id` only | server holds the map; rehydrate later by id |

---

## 🔌 Integration guide (plugging into enterprise systems)

### 1. Transparent OpenAI proxy — no application code changes
Set your existing OpenAI client's base URL to PromptShield. The gateway redacts outbound prompts, forwards them to your real upstream provider (whose key it holds server-side), and rehydrates the response.

```ts
import OpenAI from "openai";
const client = new OpenAI({
  baseURL: "http://localhost:8787/v1", // <- PromptShield
  apiKey: "your-promptshield-key",      // <- NOT your provider key
});
```

### 2. As a sidecar / middleware in a data pipeline
Run PromptShield as a container next to your service. Any stage that emits text to an LLM POSTs to `/v1/redact` first; store the returned `token_map_id` alongside the record so you can rehydrate later.

### 3. As an embedded library
```ts
import { Redactor } from "promptshield/core";
const redactor = new Redactor();
const { redacted, tokenMap } = redactor.redact(userText);
// ... send `redacted` to the model, then:
const restored = redactor.rehydrate(modelAnswer, tokenMap);
```

The HTTP layer is built with an **app-factory** (`createApp()`), so you can also mount PromptShield's routes inside your own Fastify/Node service instead of running it standalone.

---

## 🎯 Target audience & client acquisition

**Who buys this**
- **Regulated industries** (fintech, healthtech, legal, insurance) shipping LLM features.
- **Platform / infra teams** that need a central, auditable choke-point for all LLM egress.
- **Security & compliance orgs** answering "how do we prove we don't leak PII to OpenAI?" in audits.

**Client-acquisition strategy**
1. **Open-core**: MIT core drives adoption; monetize a hosted control-plane (policy management, RBAC, SIEM export, clustered token vault).
2. **Compliance-led content**: "GDPR-safe LLM usage" guides, SOC 2 evidence templates — rank for high-intent search.
3. **Marketplace distribution**: publish as a Docker image + a one-click deploy on Render/Fly/AWS Marketplace.
4. **Design-partner motion**: 3–5 regulated startups run it inline free, become reference logos + case studies.
5. **Bottom-up developer growth**: the `baseURL` swap is a 30-second install → land-and-expand into org-wide policy.

---

## Policy & actions

Every detected entity resolves to one of four actions:

| Action | Effect | Reversible? |
| --- | --- | --- |
| `redact` | Replace with a placeholder `[EMAIL_1]` | ✅ via token map |
| `mask` | Replace with a masked form `j***@acme.com` (card → `**** **** **** 1111`) | ❌ lossy by design |
| `block` | Redact **and** flag the request → API returns `422` | ✅ |
| `allow` | Leave untouched | — |

Set a server-wide default with `DEFAULT_ACTION`, or override **per request**:

```jsonc
POST /v1/redact
{
  "text": "jane@acme.com and 415-555-0132",
  "policy": { "default": "redact", "overrides": { "EMAIL": "mask" } }
}
// → "j***@acme.com and [PHONE_1]"
```

Precedence: request override → request default → server override → server default.

## Observability

`GET /metrics` exposes Prometheus counters (public, no auth) — requests by route, entities by type & action, and blocks:

```
promptshield_entities_total{action="redact",type="EMAIL"} 42
promptshield_blocked_total{route="/v1/redact"} 3
```

## Custom detection rules

Enterprises have proprietary PII the built-ins can't know about (employee IDs, project codenames). Add your own via `PROMPTSHIELD_CUSTOM_RULES` — a JSON array, no code required:

```bash
PROMPTSHIELD_CUSTOM_RULES='[
  {"name":"employee id","pattern":"EMP-\\d{5}"},
  {"name":"codename","terms":["Project Titan","Bluebird"],"flags":"i"}
]'
```

Each rule needs a `name` plus either a `pattern` (regex) or `terms` (literals). Matches render as `[EMPLOYEE_ID_1]` and rehydrate like any built-in. Invalid rules fail loudly at startup — never silently.

## Configuration

All configuration is via environment variables — see [`.env.example`](./.env.example). Secrets (provider keys, client keys) are **never** hardcoded.

## Project layout

```
src/
  core/        detectors, tokenizer, redactor, policy, audit  (pure, framework-free)
  server/      Fastify app factory, routes, plugins
  sdk/         thin JS client for integrators
  config/      zod-validated env
tests/         vitest unit + integration suites
```

## License

MIT © manijose1919
