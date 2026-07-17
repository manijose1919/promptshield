import type { Action, EntityType } from "./types.js";

export type PolicyOverrides = Partial<Record<EntityType, Action>>;

export interface PolicyConfig {
  /** Action applied to any entity type without an explicit override. */
  defaultAction: Action;
  /** Per-entity-type action overrides. */
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
   * Build a resolver that layers per-request policy over this engine.
   * Precedence (highest first):
   *   request override for the type → request default → server policy.
   * A request that supplies neither behaves identically to `resolver()`.
   */
  resolverWith(
    requestDefault?: Action,
    requestOverrides?: PolicyOverrides,
  ): (type: EntityType) => Action {
    return (type) =>
      requestOverrides?.[type] ?? requestDefault ?? this.resolve(type);
  }
}
