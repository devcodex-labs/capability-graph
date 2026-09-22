import { CapabilityGraphError } from "./errors.js";

/** Per-operation work/response limits. Byte limits use UTF-8 or raw bytes, never character counts. */
export interface BudgetConfig {
  readonly catalog: { readonly maxBytes: number; readonly maxItems: number; readonly maxItemBytes: number };
  readonly neighbors: { readonly defaultPageSize: number; readonly maxPageSize: number; readonly maxBytes: number; readonly maxItemBytes: number };
  readonly detail: {
    readonly maxCapabilities: number;
    readonly maxItemBytes: number;
    readonly maxBytes: number;
    readonly defaultKnowledgePageSize: number;
    readonly maxKnowledgePageSize: number;
  };
  readonly specification: { readonly defaultPageSize: number; readonly maxPageSize: number; readonly maxBytes: number; readonly maxItemBytes: number };
  readonly selection: { readonly maxSelected: number; readonly maxNodes: number; readonly maxEdges: number };
  readonly read: { readonly maxBytes: number; readonly maxDocumentsPerCall: number };
  readonly retrieveCapabilities: { readonly maxCandidates: number; readonly maxCandidateBytes: number };
  readonly queryKnowledge: { readonly maxHits: number; readonly maxSnippetBytes: number; readonly maxSelected: number;
    readonly maxFilterValuesPerDimension: number; readonly maxTargets: number; readonly maxTargetBytes: number };
  readonly runtime: {
    readonly defaultPageSize: number;
    readonly maxPageSize: number;
    readonly timeoutMs: number;
    readonly maxFactsBytes: number;
    readonly maxAssociationBytes: number;
  };
}

/** Configuration has one grouping level, not an arbitrary recursive schema. */
export type BudgetOverrides = { readonly [K in keyof BudgetConfig]?: Partial<BudgetConfig[K]> };

export const DEFAULT_BUDGETS: BudgetConfig = Object.freeze({
  catalog: Object.freeze({ maxBytes: 24_576, maxItems: 200, maxItemBytes: 2_048 }),
  neighbors: Object.freeze({ defaultPageSize: 50, maxPageSize: 100, maxBytes: 24_576, maxItemBytes: 2_048 }),
  detail: Object.freeze({ maxCapabilities: 20, maxItemBytes: 16_384, maxBytes: 131_072,
    defaultKnowledgePageSize: 20, maxKnowledgePageSize: 100 }),
  specification: Object.freeze({ defaultPageSize: 20, maxPageSize: 100, maxBytes: 131_072, maxItemBytes: 16_384 }),
  selection: Object.freeze({ maxSelected: 32, maxNodes: 128, maxEdges: 256 }),
  read: Object.freeze({ maxBytes: 32_768, maxDocumentsPerCall: 8 }),
  retrieveCapabilities: Object.freeze({ maxCandidates: 20, maxCandidateBytes: 512 }),
  queryKnowledge: Object.freeze({ maxHits: 8, maxSnippetBytes: 2_048, maxSelected: 32,
    maxFilterValuesPerDimension: 128, maxTargets: 128, maxTargetBytes: 131_072 }),
  runtime: Object.freeze({ defaultPageSize: 50, maxPageSize: 100, timeoutMs: 5_000,
    maxFactsBytes: 4_096, maxAssociationBytes: 2_048 }),
});

function invalid(field: string): never {
  throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", {
    nextAction: "configure_backend",
    message: "Budgets require known fields, positive finite integers, and valid page bounds.",
    details: { field },
  });
}

function dataObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(field);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) {
      invalid(field);
    }
  }
  return value as Record<string, unknown>;
}

/** Internal open-config normalization; omitted fields inherit immutable defaults. */
export function resolveBudgets(overrides: BudgetOverrides = {}): BudgetConfig {
  const input = dataObject(overrides, "budgets");
  for (const group of Object.getOwnPropertyNames(input)) {
    if (!Object.hasOwn(DEFAULT_BUDGETS, group)) invalid(`budgets.${group}`);
  }
  const output = {} as Record<keyof BudgetConfig, Record<string, number>>;
  for (const group of Object.keys(DEFAULT_BUDGETS) as (keyof BudgetConfig)[]) {
    const values: Record<string, number> = { ...DEFAULT_BUDGETS[group] };
    if (Object.hasOwn(input, group)) {
      const provided = dataObject(input[group], `budgets.${group}`);
      for (const field of Object.getOwnPropertyNames(provided)) {
        const value = provided[field];
        if (!Object.hasOwn(values, field) || typeof value !== "number" ||
            !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
          invalid(`budgets.${group}.${field}`);
        }
        values[field] = value;
      }
    }
    output[group] = Object.freeze(values);
  }
  for (const [group, initial, maximum] of [
    ["neighbors", "defaultPageSize", "maxPageSize"],
    ["detail", "defaultKnowledgePageSize", "maxKnowledgePageSize"],
    ["specification", "defaultPageSize", "maxPageSize"],
    ["runtime", "defaultPageSize", "maxPageSize"],
  ] as const) {
    if (output[group][initial]! > output[group][maximum]!) invalid(`budgets.${group}.${initial}`);
  }
  return Object.freeze(output) as unknown as BudgetConfig;
}
