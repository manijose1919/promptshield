# Security Policy

PromptShield sits on the LLM request path and handles raw PII. Please treat
vulnerabilities in this project as high priority.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the **Security** tab).

We aim to acknowledge reports within 72 hours and to provide a remediation
timeline after triage.

## Deployment checklist

- Set `PROMPTSHIELD_API_KEYS` (auth is **off** when this is empty — that is a
  development convenience, not a production default).
- Put a reverse proxy in front for TLS. Enable `TRUST_PROXY=true` **only**
  behind that trusted terminator, otherwise clients can spoof `X-Forwarded-For`
  and bypass per-IP rate limits.
- Set `PROMPTSHIELD_RATE_LIMIT` to a non-zero budget.
- Keep `/metrics` on a private network (or scrape it from the loopback
  interface). It is intentionally unauthenticated for Prometheus.
- Do not expose the audit JSONL file (`AUDIT_FILE`) outside the container.

## Scope

- The library (`promptshield/core`), REST API, OpenAI-compatible proxy, and SDK.
