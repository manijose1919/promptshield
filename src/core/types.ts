/** Canonical entity types PromptShield can detect. */
export type EntityType =
  | "EMAIL"
  | "PHONE"
  | "CREDIT_CARD"
  | "SSN"
  | "IPV4"
  | "IPV6"
  | "JWT"
  | "API_KEY"
  /** User-defined rules from configuration. The specific rule name is carried
   *  in `label` so placeholders read naturally (e.g. `[EMPLOYEE_ID_1]`). */
  | "CUSTOM";

/** Policy action applied to a detected entity. */
export type Action = "redact" | "block" | "allow";

/** A single raw match produced by a detector, before policy is applied. */
export interface Match {
  type: EntityType;
  /** Inclusive start index into the source string. */
  start: number;
  /** Exclusive end index into the source string. */
  end: number;
  /** The exact matched substring. */
  value: string;
  /** Optional display label (used in placeholders); defaults to `type`. */
  label?: string;
}

/**
 * A detector inspects text and returns zero or more matches. Detectors MUST be
 * pure and side-effect free so they can be composed and tested in isolation.
 */
export interface Detector {
  readonly type: EntityType;
  detect(text: string): Match[];
}

/** A reversible mapping from a placeholder token back to its original value. */
export interface TokenMap {
  /** placeholder -> original value */
  entries: Record<string, string>;
}

/** An entity as reported to callers (raw value intentionally omitted). */
export interface ReportedEntity {
  type: EntityType;
  /** The rule label for CUSTOM entities; equals `type` for built-ins. */
  label: string;
  placeholder: string;
  action: Action;
  start: number;
  end: number;
}

/** Result of a redaction pass. */
export interface RedactionResult {
  redacted: string;
  entities: ReportedEntity[];
  tokenMap: TokenMap;
  /** True if any entity's policy action was `block`. */
  blocked: boolean;
}
