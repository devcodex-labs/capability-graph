import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type OpenConfig, type NeighborKind } from "../src/index.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const id = (capabilityId: string, providerId = "seed") => ({ providerId, capabilityId });
const options = (sources: Record<string, () => FakeDatabase>, budgets?: OpenConfig["budgets"]): OpenConfig => ({
  hostAllowedProviders: Object.keys(sources), integrationEnabledProviders: Object.keys(sources), budgets,
  providers: Object.entries(sources).map(([providerId, source]) => ({ providerId,
    authority: { kind: "database", adapter: { id: providerId, openView: async () => { const db = source(); db.provider.providerId = providerId; return db; } } } })),
});

test("catalog warning-only pages remain bounded and make progress to legal rows", async () => {
  const db = new FakeDatabase([...Array.from({ length: 25 }, (_, i) => record(`a-${String(i).padStart(2, "0")}`, { description: "x".repeat(900) })), record("z")]);
  const graph = await CapabilityGraph.open(options({ seed: () => db }, { catalog: { maxItemBytes: 600, maxBytes: 1700 } }));
  try {
    let cursor: string | undefined; let pages = 0; const warnings: string[] = []; const items: string[] = [];
    do {
      const result = await graph.listCatalog({ cursor, limit: 7 });
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1700);
      warnings.push(...result.meta.warnings.map((item) => String(item.details?.qualifiedId)));
      items.push(...result.items.map((item) => item.id.capabilityId));
      assert.notEqual(result.nextCursor, cursor ?? "not-a-cursor");
      cursor = result.nextCursor; assert.ok(++pages < 30);
    } while (cursor);
    assert.deepEqual(items, ["z"]); assert.equal(warnings.length, 25); assert.equal(new Set(warnings).size, 25);
  } finally { await graph.close(); }
});

test("public providers/catalog project only declared static fields, including selection information", async () => {
  const db = new FakeDatabase([record("a", { distinction: "different", examples: ["example"] })]);
  const graph = await CapabilityGraph.open(options({ seed: () => db }));
  try {
    assert.equal((await graph.getProvider("seed")).authorityKind, "database");
    const page = await graph.listCatalog();
    assert.equal(page.items[0]?.whenToUse, "When needed"); assert.equal(page.items[0]?.distinction, "different");
    assert.equal("examples" in page.items[0]!, false); assert.equal("knowledge" in page.items[0]!, false);
    assert.equal(page.meta.staticRevision, page.items[0]?.staticRevision);
    assert.equal(page.meta.completeness, "complete");
  } finally { await graph.close(); }
});

test("joint catalog keeps provider revisions separate; revision selectors require one provider", async () => {
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([record("a")]), other: () => new FakeDatabase([record("z")]) }));
  try {
    const page = await graph.listCatalog();
    assert.deepEqual(page.items.map((item) => item.id.providerId), ["other", "seed"]);
    assert.equal(page.meta.staticRevision, undefined); assert.deepEqual(Object.keys(page.meta.staticRevisionByProvider!), ["other", "seed"]);
    await assert.rejects(graph.listCatalog({ requiredStaticRevision: page.items[0]!.staticRevision }), code("CG_INPUT_INVALID"));
    assert.equal((await graph.listCatalog({ requestProviderScope: [] })).items.length, 0);
    await assert.rejects(graph.listProviders({ requestProviderScope: ["forbidden"] }), code("CG_SCOPE_DENIED"));
  } finally { await graph.close(); }
});

test("catalog resumes within a database page without skipping, duplicating, or rescanning the full graph", async () => {
  const db = new FakeDatabase(Array.from({ length: 103 }, (_, i) => record(`item-${String(i).padStart(3, "0")}`))); db.pageSize = 100;
  const graph = await CapabilityGraph.open(options({ seed: () => db }));
  try {
    const before = db.scans;
    const all: string[] = []; let cursor: string | undefined;
    do {
      const page = await graph.listCatalog({ limit: 7, cursor });
      all.push(...page.items.map((entry) => entry.id.capabilityId)); cursor = page.nextCursor;
      if (cursor) assert.equal(page.meta.completeness, "truncated");
      assert.ok(db.scans - before < 20);
    } while (cursor);
    assert.deepEqual(all, db.records.map((entry) => entry.capabilityId));
    assert.equal(new Set(all).size, 103);
  } finally { await graph.close(); }
});

test("catalog byte truncation and oversized rows preserve later legal entries", async () => {
  const db = new FakeDatabase([record("a", { description: "x".repeat(900) }), ...["b", "c", "d", "e"].map((key) => record(key))]); db.pageSize = 100;
  const graph = await CapabilityGraph.open(options({ seed: () => db }, { catalog: { maxItemBytes: 600, maxBytes: 1900 } }));
  try {
    let cursor: string | undefined; const all: string[] = []; let warnings = 0;
    do {
      const page = await graph.listCatalog({ cursor }); cursor = page.nextCursor;
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1900);
      all.push(...page.items.map((entry) => entry.id.capabilityId)); warnings += page.meta.warnings.length;
      if (page.meta.warnings.length) assert.equal(page.meta.completeness, "partial");
    } while (cursor);
    assert.deepEqual(all, ["b", "c", "d", "e"]); assert.equal(warnings, 1);
  } finally { await graph.close(); }
});

test("catalog filters explicit parents only and cursor filter/revision changes fail", async () => {
  let generation = 0;
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([
    record("a", { name: String(generation), parents: ["root"] }), record("a.child"), record("b", { parents: ["root"] }), record("root"),
  ]) }));
  try {
    const page = await graph.listCatalog({ parent: id("root"), limit: 1 });
    assert.equal(page.items[0]?.id.capabilityId, "a"); assert.ok(page.nextCursor);
    await assert.rejects(graph.listCatalog({ cursor: page.nextCursor, limit: 1 }), code("CG_REVISION_MISMATCH"));
    await assert.rejects(graph.listCatalog({ cursor: "%%%" }), code("CG_INPUT_INVALID"));
    const old = page.meta.staticRevision!; generation++; await graph.reload();
    await assert.rejects(graph.listCatalog({ parent: id("root"), limit: 1, cursor: page.nextCursor }), code("CG_REVISION_MISMATCH"));
    const second = await graph.listCatalog({ parent: id("root"), limit: 1, cursor: page.nextCursor, requiredStaticRevision: old });
    assert.equal(second.items[0]?.id.capabilityId, "b"); assert.equal(second.meta.servedFrom, "previous");
  } finally { await graph.close(); }
});

test("batch details retain duplicate/input error slots; expose bounded summaries, not raw edges", async () => {
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([record("a", { parents: ["root"] }), record("root")]) }));
  try {
    const batch = await graph.getCapabilities([id("a"), id("missing"), id("a"), { capabilityId: "a" }, id("a", "forbidden")], { neighborLimitPerKind: 0 });
    assert.deepEqual(batch.results.map((entry) => entry.ok), [true, false, true, false, false]);
    assert.deepEqual(batch.results.map((entry) => entry.inputIndex), [0, 1, 2, 3, 4]);
    assert.equal(batch.meta.completeness, "partial");
    const first = batch.results[0]!;
    assert.ok(first.ok); assert.equal("parents" in first.value, false);
    assert.equal(first.value.neighborSummaries.parents.completeness, "truncated");
    assert.equal(first.value.neighborSummaries.parents.items.length, 0);
    await assert.rejects(graph.getCapabilities(Array.from({ length: 21 }, () => id("a"))), code("CG_BUDGET_EXCEEDED"));
  } finally { await graph.close(); }
});

test("detail KnowledgeSummary does not expand collections and resumes by knowledgeId", async () => {
  const doc = (knowledgeId: string) => ({ kind: "document", knowledgeId, locator: { type: "http", url: `https://example.test/${knowledgeId}` } });
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([record("a", { knowledge: [doc("z"), { kind: "collection", knowledgeId: "a", members: [doc("inner")] }] })]) }));
  try {
    const bound = graph.forProvider("seed");
    const first = (await bound.getCapabilities(["a"], { knowledgeLimit: 1 })).results[0]!;
    assert.ok(first.ok); assert.deepEqual(first.value.knowledge.items, [{ kind: "collection", knowledgeId: "a", memberCount: 1 }]);
    assert.equal(first.value.knowledge.completeness, "truncated");
    const second = (await bound.getCapabilities(["a"], { knowledgeLimit: 1, knowledgeCursors: { "seed::a": first.value.knowledge.nextCursor! } })).results[0]!;
    assert.ok(second.ok); assert.equal(second.value.knowledge.items[0]?.knowledgeId, "z"); assert.equal(second.value.knowledge.completeness, "complete");
  } finally { await graph.close(); }
});

test("detail item and batch byte budgets report failures at their specified levels", async () => {
  const source = () => new FakeDatabase([record("a", { examples: ["x".repeat(2000)] }), record("b")]);
  const graph = await CapabilityGraph.open(options({ seed: source }, { detail: { maxItemBytes: 1500 } }));
  try {
    const page = await graph.getCapabilities([id("a"), id("b")]);
    assert.equal(page.results[0]?.ok, false); assert.equal(page.results[1]?.ok, true);
  } finally { await graph.close(); }
  const tiny = await CapabilityGraph.open(options({ seed: source }, { detail: { maxBytes: 100 } }));
  try { await assert.rejects(tiny.getCapabilities([id("b")]), code("CG_BUDGET_EXCEEDED")); } finally { await tiny.close(); }
});

test("six neighbor groups paginate independently and relatedBy is not related", async () => {
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([
    record("a", { parents: ["root"], related: ["root"] }), record("b", { parents: ["root"] }), record("root"),
  ]) }));
  try {
    const first = await graph.getNeighbors(id("root"), { limitPerKind: 1 });
    assert.equal(first.groups.children.completeness, "truncated"); assert.equal(first.groups.related.items.length, 0);
    assert.equal(first.groups.relatedBy.items[0]?.id.capabilityId, "a");
    const second = await graph.getNeighbors(id("root"), { kinds: ["children"], limitPerKind: 1, cursors: { children: first.groups.children.nextCursor! } });
    assert.equal(second.groups.children.items[0]?.id.capabilityId, "b"); assert.equal(second.groups.children.completeness, "complete");
  } finally { await graph.close(); }
});

test("bound facade matches canonical calls and rejects JavaScript scope overrides", async () => {
  const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([record("a")]) }));
  try {
    const bound = graph.forProvider("seed");
    assert.deepEqual(await bound.getCapabilities(["a"]), await graph.getCapabilities([id("a")]));
    assert.throws(() => graph.forProvider("outside"), code("CG_SCOPE_DENIED"));
    assert.throws(() => bound.listCatalog({ requestProviderScope: ["outside"] } as never), code("CG_INPUT_INVALID"));
    await assert.rejects(bound.listCatalog({ parent: id("a", "outside") }), code("CG_SCOPE_DENIED"));
  } finally { await graph.close(); }
});

test("R3: neighbors enforce UTF-8 item bytes and warning-only pages advance without lost rows", async () => {
  const db = new FakeDatabase([
    ...Array.from({ length: 20 }, (_, i) => record(`a-${String(i).padStart(2, "0")}`, { parents: ["root"], description: "\u754c".repeat(11000) })),
    record("root"), record("y-utf8", { parents: ["root"], description: "\u754c".repeat(700) }), record("z", { parents: ["root"] }),
  ]); db.pageSize = 3;
  const graph = await CapabilityGraph.open(options({ seed: () => db }, { neighbors: { maxBytes: 1800 } }));
  try {
    let cursor: string | undefined; let pages = 0; const omitted: string[] = []; const items: string[] = [];
    do {
      const page = await graph.getNeighbors(id("root"), { kinds: ["children"], cursors: cursor ? { children: cursor } : undefined });
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 1800);
      omitted.push(...page.meta.warnings.map((warning) => String(warning.details?.qualifiedId)));
      items.push(...page.groups.children.items.map((item) => item.id.capabilityId));
      if (page.meta.warnings.length) { assert.equal(page.meta.completeness, "partial"); assert.equal(page.groups.children.completeness, "partial"); }
      if (page.groups.children.nextCursor) assert.notEqual(page.groups.children.nextCursor, cursor);
      cursor = page.groups.children.nextCursor; assert.ok(++pages < 30);
    } while (cursor);
    assert.equal(omitted.length, 21); assert.equal(new Set(omitted).size, 21); assert.deepEqual(items, ["z"]);
  } finally { await graph.close(); }
});

test("R3: six groups share a byte limit and each cursor resumes the first unconsumed row", async () => {
  const kinds: NeighborKind[] = ["parents", "children", "specializes", "specializedBy", "related", "relatedBy"];
  const targets = Array.from({ length: 6 }, (_, i) => `z-${i}`);
  const incoming = Array.from({ length: 6 }, (_, i) => `a-${i}`);
  const db = new FakeDatabase([...incoming.map((key) => record(key, { parents: ["root"], specializes: ["root"], description: "\u754c".repeat(220) })),
    record("root", { parents: targets, specializes: targets, related: targets }),
    ...targets.map((key) => record(key, { description: "\u754c".repeat(220), related: ["root"] }))]);
  db.pageSize = 3;
  const graph = await CapabilityGraph.open(options({ seed: () => db }, { neighbors: { maxBytes: 4000 } }));
  try {
    let active = kinds; let cursors: Partial<Record<NeighborKind, string>> = {}; let pages = 0;
    const seen = Object.fromEntries(kinds.map((kind) => [kind, [] as string[]])) as Record<NeighborKind, string[]>;
    do {
      const page = await graph.getNeighbors(id("root"), { kinds: active, cursors });
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 4000);
      const following: NeighborKind[] = []; const next: typeof cursors = {};
      for (const kind of active) {
        seen[kind].push(...page.groups[kind].items.map((item) => item.id.capabilityId));
        const cursor = page.groups[kind].nextCursor;
        if (cursor) { following.push(kind); next[kind] = cursor; }
      }
      assert.ok(active.some((kind) => page.groups[kind].items.length > 0));
      active = following; cursors = next; assert.ok(++pages < 30);
    } while (active.length);
    for (const kind of kinds) assert.deepEqual(seen[kind], ["children", "specializedBy"].includes(kind) ? incoming : targets);
  } finally { await graph.close(); }
});

test("R3: unrepresentable neighbor pages fail instead of returning an empty looping cursor", async () => {
  for (const maxBytes of [100, 1300]) {
    const graph = await CapabilityGraph.open(options({ seed: () => new FakeDatabase([record("a", { parents: ["root"], description: "x".repeat(1700) }), record("root")]) },
      { neighbors: { maxBytes, maxItemBytes: 4000 } }));
    try { await assert.rejects(graph.getNeighbors(id("root"), { kinds: ["children"] }), code("CG_BUDGET_EXCEEDED")); }
    finally { await graph.close(); }
  }
});
