import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, type OpenConfig } from "../src/index.js";
import { decodeCursor, encodeCursor, MAX_PUBLIC_CURSOR_LENGTH, type CursorBinding } from "../src/query/cursor.js";
import type { StorePage, StorePageRequest } from "../src/store/types.js";
import { FileFixture, record } from "./contract/file-fixture.js";

const config = (fixture: FileFixture, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: fixture.authority }], ...extra,
});

for (const kind of ["catalog", "neighbors", "detail-knowledge"] as const) {
  test(`deep R4: ${kind} cursor enforces the final encoded boundary and round-trips`, () => {
    const binding: CursorBinding = { kind, staticRevision: "s:1", filter: {} };
    for (const after of ["short", "\u4e2d".repeat(50), '"\\'.repeat(50)]) {
      const encoded = encodeCursor(binding, after);
      assert.ok(encoded.length <= MAX_PUBLIC_CURSOR_LENGTH);
      assert.deepEqual(decodeCursor(encoded, binding), { after });
    }
    // Each extra ASCII byte adds one or two base64url characters. Find the largest accepted payload.
    let lower = 0; let upper = MAX_PUBLIC_CURSOR_LENGTH;
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      try { encodeCursor(binding, "x".repeat(middle)); lower = middle; } catch { upper = middle - 1; }
    }
    assert.equal(decodeCursor(encodeCursor(binding, "x".repeat(lower)), binding)!.after.length, lower);
    assert.throws(() => encodeCursor(binding, "x".repeat(lower + 1)), { code: "CG_BUDGET_EXCEEDED" });
    for (const after of ["x".repeat(30000), "\u4e2d".repeat(12000), '"'.repeat(20000), "x".repeat(40000)]) {
      assert.throws(() => encodeCursor(binding, after), { code: "CG_BUDGET_EXCEEDED" });
    }
    assert.throws(() => decodeCursor("x".repeat(MAX_PUBLIC_CURSOR_LENGTH + 1), binding), { code: "CG_INPUT_INVALID" });
  });
}

test("deep A: detail zero-neighbor summary and normal public cursor continuations remain supported", async () => {
  const knowledge = ["one", "two"].map((knowledgeId) => ({ kind: "document", knowledgeId, role: "guide", locator: { type: "http", url: `https://example.test/${knowledgeId}` } }));
  const graph = await CapabilityGraph.open(config(new FileFixture([record("a", { related: ["b", "c"], knowledge }), record("b"), record("c")])));
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
