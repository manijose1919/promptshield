import type { ReportedEntity } from "../core/types.js";

/** Escape a Prometheus label value per the exposition format spec. */
function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

interface CounterVec {
  help: string;
  values: Map<string, number>; // serialized-labels -> value
}

/**
 * Tiny, dependency-free Prometheus counter registry. We only need counters, so
 * we avoid pulling in a full client library (and its transitive surface).
 */
export class Metrics {
  private readonly counters = new Map<string, CounterVec>();

  private counter(name: string, help: string): CounterVec {
    let c = this.counters.get(name);
    if (!c) {
      c = { help, values: new Map() };
      this.counters.set(name, c);
    }
    return c;
  }

  private inc(
    name: string,
    help: string,
    labels: Record<string, string>,
    by = 1,
  ): void {
    const c = this.counter(name, help);
    const key = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${escapeLabel(labels[k]!)}"`)
      .join(",");
    c.values.set(key, (c.values.get(key) ?? 0) + by);
  }

  /** Record one API request against a route. */
  recordRequest(route: string): void {
    this.inc("promptshield_requests_total", "Total API requests by route.", {
      route,
    });
  }

  /** Record the outcome of a redaction pass (entities by type + action, blocks). */
  recordRedaction(route: string, entities: ReportedEntity[], blocked: boolean): void {
    for (const e of entities) {
      this.inc(
        "promptshield_entities_total",
        "Detected entities by type and action.",
        { type: e.type, action: e.action },
      );
    }
    if (blocked) {
      this.inc("promptshield_blocked_total", "Requests blocked by policy.", {
        route,
      });
    }
  }

  /** Record a request rejected by the rate limiter. */
  recordRateLimited(route: string): void {
    this.inc(
      "promptshield_rate_limited_total",
      "Requests rejected by rate limiting.",
      { route },
    );
  }

  /** Render all counters in Prometheus text exposition format (v0.0.4). */
  render(): string {
    const lines: string[] = [];
    for (const [name, c] of this.counters) {
      lines.push(`# HELP ${name} ${c.help}`);
      lines.push(`# TYPE ${name} counter`);
      if (c.values.size === 0) {
        lines.push(`${name} 0`);
        continue;
      }
      for (const [labelKey, value] of c.values) {
        lines.push(labelKey ? `${name}{${labelKey}} ${value}` : `${name} ${value}`);
      }
    }
    return lines.join("\n") + "\n";
  }
}
