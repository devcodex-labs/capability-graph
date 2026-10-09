import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { CapabilityGraph, type BudgetOverrides, type KnowledgeDocumentRef } from "../src/index.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const id = (capabilityId: string) => ({ providerId: "seed", capabilityId });
const doc = (knowledgeId: string, role = "guide"): KnowledgeDocumentRef => ({
  kind: "document", knowledgeId, role, locale: "en", locator: { type: "http", url: "https://example.test/guide" },
});
async function open(budgets: BudgetOverrides = {}, documents = 1) {
  const db = new FakeDatabase([
    record("a", { knowledge: Array.from({ length: documents }, (_, i) => doc(`D-${i}`)) }), record("b"),
  ]);
  db.provider = { ...db.provider, ...{ specification: {
    specificationId: "rules", version: "1", documents: [doc("SPEC", "specification")],
  } } };
  let calls = 0;
  let text = "guide";
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "controlled", openView: async () => db } } }],
    budgets,
    readers: [{ id: "counted", canRead: () => true, async read(ref) {
      calls++;
      const bytes = Buffer.from(text);
      return { bytes, contentId: `k:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`,
        source: ref.locator.type === "http" ? ref.locator.url : ref.locator.path, contentType: "text/plain" };
    } }],
    knowledgeRetriever: { id: "not-called-for-empty-filter", async retrieve() { throw new Error("must not run"); } },
  });
  db.reads = 0;
  return { graph, db, calls: () => calls, setText: (value: string) => { text = value; } };
}

test("direct-read raw counts reject before authority reads and Reader calls, including bound conversion", async () => {
  const f = await open();
  try {
    for (const selected of [Array(33).fill(id("a")), Array.from({ length: 2000 }, (_, i) => id(`missing-${i}`))]) {
      assert.throws(() => f.graph.readDocuments({ selected }), { code: "CG_BUDGET_EXCEEDED" });
      assert.throws(() => f.graph.forProvider("seed").readDocuments({ selected: selected.map((value) => value.capabilityId) }), { code: "CG_BUDGET_EXCEEDED" });
    }
    for (const field of ["knowledgeIds", "roles", "locales"] as const) {
      const value = field === "locales" ? "en" : "missing";
      const filters = { [field]: Array(129).fill(value) };
      assert.throws(() => f.graph.readDocuments({ selected: [id("a")], ...filters }), { code: "CG_BUDGET_EXCEEDED" });
      assert.throws(() => f.graph.forProvider("seed").readDocuments({ selected: ["a"], ...filters }), { code: "CG_BUDGET_EXCEEDED" });
      if (field !== "roles") {
        assert.throws(() => f.graph.readSpecification({ providerId: "seed", ...filters }), { code: "CG_BUDGET_EXCEEDED" });
        assert.throws(() => f.graph.forProvider("seed").readSpecification(filters), { code: "CG_BUDGET_EXCEEDED" });
      }
    }
    assert.equal(f.db.reads, 0); assert.equal(f.calls(), 0);
  } finally { await f.graph.close(); }
});

test("read input boundaries preserve deterministic failure slots and filtered-empty semantics", async () => {
  const f = await open({}, 8);
  try {
    const selected = [id("a"), ...Array.from({ length: 31 }, (_, i) => id(`missing-${i}`))];
    const knowledgeIds = [...Array.from({ length: 8 }, (_, i) => `D-${i}`), ...Array.from({ length: 120 }, (_, i) => `UNKNOWN-${i}`)];
    const response = await f.graph.readDocuments({ selected, knowledgeIds });
    assert.equal(response.results.length, 159); // 8 planned + 31 failed capabilities + 120 unknown IDs.
    assert.equal(response.results.filter((item) => item.ok).length, 8);
    assert.deepEqual(response.results.map((item) => item.inputIndex), Array.from({ length: 159 }, (_, i) => i));
    assert.equal(response.meta.completeness, "partial");
    assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 4194304);
    const zero = await f.graph.forProvider("seed").readDocuments({ selected: ["a"], knowledgeIds: [] });
    assert.deepEqual(zero.results, []); assert.equal(zero.knowledgeState, "filtered_empty");
    const repeated = await f.graph.readDocuments({ selected: Array(32).fill(id("a")),
      knowledgeIds: Array(128).fill("D-0"), roles: Array(128).fill("guide"), locales: Array(128).fill("en") });
    assert.equal(repeated.results.length, 1); assert.equal(repeated.results[0]?.ok, true);
    const spec = await f.graph.forProvider("seed").readSpecification({ knowledgeIds: Array(128).fill("UNKNOWN") });
    assert.equal(spec.results.length, 1); assert.equal(spec.results[0]?.ok, false);
  } finally { await f.graph.close(); }
});

test("expanded document limit rejects without Reader I/O and per-document byte overflow stays an item error", async () => {
  const f = await open({ read: { maxDocumentsPerCall: 1, maxBytes: 4, maxSelected: 2 } }, 2);
  try {
    await assert.rejects(f.graph.readDocuments({ selected: [id("a")] }), { code: "CG_BUDGET_EXCEEDED" });
    assert.equal(f.calls(), 0);
    const response = await f.graph.readDocuments({ selected: [id("a")], knowledgeIds: ["D-0"] });
    const slot = response.results[0]!;
    assert.ok(!slot.ok); assert.equal(slot.error.code, "CG_BUDGET_EXCEEDED");
    assert.equal(response.meta.completeness, "partial");
  } finally { await f.graph.close(); }
});

test("complete-response UTF-8 boundary includes escaped text, failures, metadata and view", async () => {
  for (const specification of [false, true]) {
    const body = '中文"\\\0'.repeat(80);
    const invoke = (graph: CapabilityGraph) => specification
      ? graph.readSpecification({ providerId: "seed", knowledgeIds: ["SPEC", "UNKNOWN"] })
      : graph.readDocuments({ selected: [id("a"), id("missing")], knowledgeIds: ["D-0", "UNKNOWN"] });
    const initial = await open({ read: { maxResponseBytes: 9999 } });
    let size: number;
    try {
      initial.setText(body);
      size = Buffer.byteLength(JSON.stringify(await invoke(initial.graph)), "utf8");
      assert.ok(size >= 1000 && size < 9999); // Replacing the four-digit limit does not change envelope length.
    } finally { await initial.graph.close(); }
    for (const maximum of [size!, size! - 1]) {
      const f = await open({ read: { maxResponseBytes: maximum } });
      try {
        f.setText(body);
        if (maximum === size!) {
          const response = await invoke(f.graph);
          assert.equal(Buffer.byteLength(JSON.stringify(response), "utf8"), maximum);
          assert.equal(response.meta.completeness, "partial");
        } else await assert.rejects(invoke(f.graph), { code: "CG_BUDGET_EXCEEDED", nextAction: "page_or_filter" });
      } finally { await f.graph.close(); }
    }
  }
});

test("default response limit accepts eight fully escaped 32 KiB bodies", async () => {
  const f = await open({}, 8);
  try {
    f.setText("\0".repeat(32768));
    const response = await f.graph.readDocuments({ selected: [id("a")] });
    assert.ok(response.results.every((item) => item.ok && item.value.byteLength === 32768));
    assert.equal(response.results.length, 8);
    const size = Buffer.byteLength(JSON.stringify(response));
    assert.ok(size > 8 * 32768 && size <= 4194304);
  } finally { await f.graph.close(); }
});

test("read budgets do not replace queryKnowledge selection/filter budgets", async () => {
  const f = await open({ read: { maxSelected: 1, maxFilterValuesPerDimension: 1, maxResponseBytes: 1 } });
  try {
    const page = await f.graph.queryKnowledge({ text: "guide", selected: [id("a"), id("b")], roles: ["unused", "other"] });
    assert.equal(page.knowledgeState, "filtered_empty"); assert.deepEqual(page.items, []);
    assert.throws(() => f.graph.readDocuments({ selected: [id("a"), id("b")] }), { code: "CG_BUDGET_EXCEEDED" });
  } finally { await f.graph.close(); }
});
