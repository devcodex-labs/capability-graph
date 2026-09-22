import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, type OpenConfig } from "../src/index.js";
import { decodeCursor, encodeCursor, MAX_PUBLIC_CURSOR_LENGTH, type CursorBinding } from "../src/query/cursor.js";
import type { StorePage, StorePageRequest } from "../src/store/types.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { FixtureRuntimeAdapter, instance } from "./contract/fixture-runtime-adapter.js";

const config = (database: FakeDatabase, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => database } } }], ...extra,
});

for (const kind of ["catalog", "neighbors", "detail-knowledge", "runtime"] as const) {
  test(`deep R4: ${kind} cursor enforces the final encoded boundary and round-trips`, () => {
    const binding: CursorBinding = { kind, staticRevision: "s:1", filter: {} };
    const runtimeRevision = kind === "runtime" ? "r:1" : undefined;
    for (const after of ["short", "\u4e2d".repeat(50), '"\\'.repeat(50)]) {
      const encoded = encodeCursor(binding, after, runtimeRevision);
      assert.ok(encoded.length <= MAX_PUBLIC_CURSOR_LENGTH);
      assert.deepEqual(decodeCursor(encoded, binding), { after, ...(runtimeRevision ? { runtimeRevision } : {}) });
    }
    // Each extra ASCII byte adds one or two base64url characters. Find the largest accepted payload.
    let lower = 0; let upper = MAX_PUBLIC_CURSOR_LENGTH;
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      try { encodeCursor(binding, "x".repeat(middle), runtimeRevision); lower = middle; } catch { upper = middle - 1; }
    }
    assert.equal(decodeCursor(encodeCursor(binding, "x".repeat(lower), runtimeRevision), binding)!.after.length, lower);
    assert.throws(() => encodeCursor(binding, "x".repeat(lower + 1), runtimeRevision), { code: "CG_BUDGET_EXCEEDED" });
    for (const after of ["x".repeat(30000), "\u4e2d".repeat(12000), '"'.repeat(20000), "x".repeat(40000)]) {
      assert.throws(() => encodeCursor(binding, after, runtimeRevision), { code: "CG_BUDGET_EXCEEDED" });
    }
    assert.throws(() => decodeCursor("x".repeat(MAX_PUBLIC_CURSOR_LENGTH + 1), binding), { code: "CG_INPUT_INVALID" });
  });
}

for (const field of ["nextCursor", "runtimeRevision"] as const) {
  test(`deep R4: oversized runtime ${field} fails before returning a public cursor`, async () => {
    const adapter = new FixtureRuntimeAdapter((input) => ({ instances: [instance()],
      nextCursor: field === "nextCursor" ? "x".repeat(30000) : "second",
      observation: { source: "fixture://routes", observedAt: new Date().toISOString(),
        runtimeRevision: field === "runtimeRevision" ? "r".repeat(30000) : "r:1", observedAgainstStaticRevision: input.currentStaticRevision,
        compatibility: "compatible", freshness: "current", availability: "available" },
    }));
    const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a")]), { runtimeAdapters: [adapter] }));
    try {
      await assert.rejects(graph.queryRuntime({ project: "project-a", environment: "test" }), { code: "CG_BUDGET_EXCEEDED" });
      assert.equal(adapter.calls, 1); assert.equal((await graph.listCatalog()).items.length, 1);
    } finally { await graph.close(); }
  });
}

class LongCursorDatabase extends FakeDatabase {
  override page<T>(items: readonly T[], page: StorePageRequest): StorePage<T> {
    const start = page.cursor === undefined ? 0 : Number(page.cursor.slice(30000));
    return { items: items.slice(start, start + 1), ...(start + 1 < items.length ? { nextCursor: `${"x".repeat(30000)}${start + 1}` } : {}) };
  }
}
for (const operation of ["catalog", "neighbors"] as const) {
  test(`deep R4: ${operation} rejects long store cursors even with enlarged page budgets`, async () => {
    const graph = await CapabilityGraph.open(config(new LongCursorDatabase([
      record("a", { related: ["b", "c"] }), record("b"), record("c"),
    ]), { budgets: { catalog: { maxBytes: 100000 }, neighbors: { maxBytes: 100000 } } }));
    try {
      const query = operation === "catalog" ? graph.listCatalog({ limit: 1 }) :
        graph.forProvider("seed").getNeighbors("a", { limitPerKind: 1, kinds: ["related"] });
      await assert.rejects(query, { code: "CG_BUDGET_EXCEEDED" });
    } finally { await graph.close(); }
  });
}

test("deep A: detail zero-neighbor summary and normal public cursor continuations remain supported", async () => {
  const knowledge = ["one", "two"].map((knowledgeId) => ({ kind: "document", knowledgeId, role: "guide", locator: { type: "http", url: `https://example.test/${knowledgeId}` } }));
  const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a", { related: ["b", "c"], knowledge }), record("b"), record("c")])));
  try {
    const bound = graph.forProvider("seed");
    const detail = (await bound.getCapabilities(["a"], { neighborLimitPerKind: 0, knowledgeLimit: 1 })).results[0]!;
    assert.ok(detail.ok); assert.deepEqual(detail.value.neighborSummaries.related, { items: [], completeness: "truncated" });
    await assert.rejects(bound.getNeighbors("a", { limitPerKind: 0 }), { code: "CG_INPUT_INVALID" });
    const next = (await bound.getCapabilities(["a"], { neighborLimitPerKind: 0, knowledgeLimit: 1,
      knowledgeCursors: { "seed::a": detail.value.knowledge.nextCursor! } })).results[0]!;
    assert.ok(next.ok); assert.equal(next.value.knowledge.items[0]!.knowledgeId, "two");
    const catalog = await bound.listCatalog({ limit: 1 });
    assert.equal((await bound.listCatalog({ limit: 1, cursor: catalog.nextCursor })).items[0]!.id.capabilityId, "b");
    const neighbors = await bound.getNeighbors("a", { kinds: ["related"], limitPerKind: 1 });
    const tail = await bound.getNeighbors("a", { kinds: ["related"], limitPerKind: 1, cursors: { related: neighbors.groups.related.nextCursor! } });
    assert.equal(tail.groups.related.items[0]!.id.capabilityId, "c");
  } finally { await graph.close(); }
});
