import assert from "node:assert/strict";
import { test } from "node:test";
import type { BudgetConfig, BudgetOverrides } from "@devcodex/capability-graph";
import { DEFAULT_BUDGETS, resolveBudgets } from "../src/budgets.js";

test("T-F11: one nested override retains every other default", () => {
  const input: BudgetOverrides = { catalog: { maxBytes: 8_192 } };
  const actual = resolveBudgets(input);
  assert.deepEqual(actual, { ...DEFAULT_BUDGETS, catalog: { ...DEFAULT_BUDGETS.catalog, maxBytes: 8_192 } });
  assert.deepEqual(input, { catalog: { maxBytes: 8_192 } });
  assert.deepEqual(resolveBudgets(), DEFAULT_BUDGETS);
  assert.deepEqual(resolveBudgets({ catalog: {} }), DEFAULT_BUDGETS);
});

test("T-F11: all numeric defaults match the design", () => {
  assert.deepEqual(resolveBudgets(), {
    catalog: { maxBytes: 24_576, maxItems: 200, maxItemBytes: 2_048 },
    neighbors: { defaultPageSize: 50, maxPageSize: 100, maxBytes: 24_576, maxItemBytes: 2_048 },
    detail: { maxCapabilities: 20, maxItemBytes: 16_384, maxBytes: 131_072,
      defaultKnowledgePageSize: 20, maxKnowledgePageSize: 100 },
    specification: { defaultPageSize: 20, maxPageSize: 100, maxBytes: 131_072, maxItemBytes: 16_384 },
    selection: { maxSelected: 32, maxNodes: 128, maxEdges: 256 },
    read: { maxBytes: 32_768, maxDocumentsPerCall: 8 },
    retrieveCapabilities: { maxCandidates: 20, maxCandidateBytes: 512 },
    queryKnowledge: { maxHits: 8, maxSnippetBytes: 2_048, maxSelected: 32,
      maxFilterValuesPerDimension: 128, maxTargets: 128, maxTargetBytes: 131_072 },
    runtime: { defaultPageSize: 50, maxPageSize: 100, timeoutMs: 5_000, maxFactsBytes: 4_096, maxAssociationBytes: 2_048 },
  });
});

test("T-F11: a full override is accepted without shared mutable state", () => {
  const full = Object.fromEntries(Object.entries(DEFAULT_BUDGETS).map(([group, fields]) =>
    [group, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number(value) * 2]))])) as unknown as BudgetConfig;
  const first = resolveBudgets(full);
  assert.deepEqual(first, full);
  assert.notEqual(first.catalog, full.catalog);
  assert.ok(Object.isFrozen(first));
  for (const group of Object.values(first)) assert.ok(Object.isFrozen(group));
  assert.throws(() => { (first.catalog as { maxBytes: number }).maxBytes = 1; }, TypeError);
  assert.equal(resolveBudgets().catalog.maxBytes, 24_576);
});

for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, "100", null, undefined]) {
  test(`T-F11: reject invalid numeric override ${String(bad)}`, () => {
    assert.throws(() => resolveBudgets({ catalog: { maxBytes: bad } } as never), {
      code: "CG_CONFIG_INCOMPLETE", nextAction: "configure_backend",
    });
  });
}

test("T-F11: unknown groups, fields and non-data objects are not silently ignored", () => {
  for (const bad of [null, [], new Date(), "budgets", { catalog: null }, { catalog: undefined },
    { catalog: [] }, { catalogs: {} }, { catalog: { bytes: 1 } },
    JSON.parse('{"__proto__":{"polluted":1}}'), { [Symbol("unknown")]: {} }]) {
    assert.throws(() => resolveBudgets(bad as never), { code: "CG_CONFIG_INCOMPLETE" });
  }
  let called = false;
  const accessor = { get catalog() { called = true; return {}; } };
  assert.throws(() => resolveBudgets(accessor), { code: "CG_CONFIG_INCOMPLETE" });
  assert.equal(called, false);
});

test("T-F11: page defaults cannot exceed effective maxima", () => {
  for (const bad of [{ neighbors: { maxPageSize: 1 } }, { runtime: { maxPageSize: 1 } },
    { detail: { maxKnowledgePageSize: 1 } }]) {
    assert.throws(() => resolveBudgets(bad), { code: "CG_CONFIG_INCOMPLETE" });
  }
  assert.equal(resolveBudgets({ neighbors: { defaultPageSize: 1, maxPageSize: 1 } }).neighbors.maxPageSize, 1);
});
