import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EntityType, ReportedEntity } from "./types.js";

/**
 * A privacy-preserving audit event. By design it records WHAT kinds of PII were
 * seen and how many — never the raw values or the placeholder→value mapping.
 * The audit trail can therefore never itself become a data-leak vector.
 */
export interface AuditEvent {
  ts: string;
  requestId: string;
  route: string;
  blocked: boolean;
  entityCounts: Partial<Record<EntityType, number>>;
  totalEntities: number;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

/** Discards everything. */
class NoneSink implements AuditSink {
  async record(): Promise<void> {}
}

/** Writes one JSON line per event to stdout. */
class StdoutSink implements AuditSink {
  async record(event: AuditEvent): Promise<void> {
    process.stdout.write(JSON.stringify(event) + "\n");
  }
}

/** Appends one JSON line per event to a file (JSONL), creating dirs as needed. */
class FileSink implements AuditSink {
  private dirEnsured = false;
  constructor(private readonly path: string) {}
  async record(event: AuditEvent): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(dirname(this.path), { recursive: true });
      this.dirEnsured = true;
    }
    await appendFile(this.path, JSON.stringify(event) + "\n", "utf8");
  }
}

export function createAuditSink(
  kind: "none" | "stdout" | "file",
  file: string,
): AuditSink {
  switch (kind) {
    case "none":
      return new NoneSink();
    case "stdout":
      return new StdoutSink();
    case "file":
      return new FileSink(file);
  }
}

/** Tally entities by type without retaining any raw values. */
export function summarizeEntities(entities: ReportedEntity[]): {
  entityCounts: Partial<Record<EntityType, number>>;
  totalEntities: number;
} {
  const entityCounts: Partial<Record<EntityType, number>> = {};
  for (const e of entities) {
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
  }
  return { entityCounts, totalEntities: entities.length };
}
