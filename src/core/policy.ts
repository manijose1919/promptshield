import type { Action, EntityType } from "./types.js";

export type PolicyOverrides = Partial<Record<EntityType, Action>>;

export interface PolicyConfig {
  /** Action applied to any entity type without an explicit override. */
  defaultAction: Action;
  /** Per-entity-type action overrides. */
  overrides?: PolicyOverrides;
}

/** A policy scoped to something narrower than the server (a request, an API key). */
export interface ScopedPolicy {
  default?: Action;
  overrides?: PolicyOverrides;
}

/**
 * Resolves the policy action for a given entity type. Small, immutable, and
 * pure so it can be shared safely across concurrent requests.
 */
export class PolicyEngine {
  private readonly defaultAction: Action;
  private readonly overrides: PolicyOverrides;

  constructor(config: PolicyConfig) {
    this.defaultAction = config.defaultAction;
    this.overrides = { ...config.overrides };
  }

  resolve(type: EntityType): Action {
    return this.overrides[type] ?? this.defaultAction;
  }

  /** Bound resolver convenient for passing to `new Redactor({ resolveAction })`. */
  resolver(): (type: EntityType) => Action {
    return (type) => this.resolve(type);
  }

  /**
   * Build a resolver that layers per-request and (optionally) per-API-key policy
   * over this engine. Precedence (highest first):
   *   request override → request default →
   *   key override → key default →
   *   server override → server default.
   * Any layer that supplies nothing is skipped, so passing no arguments behaves
   * identically to `resolver()`.
   */
  resolverWith(
    requestDefault?: Action,
    requestOverrides?: PolicyOverrides,
    keyPolicy?: ScopedPolicy,
  ): (type: EntityType) => Action {
    return (type) =>
      requestOverrides?.[type] ??
      requestDefault ??
      keyPolicy?.overrides?.[type] ??
      keyPolicy?.default ??
      this.resolve(type);
  }
}
