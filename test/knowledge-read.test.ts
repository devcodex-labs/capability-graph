import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type KnowledgeDocumentRef, type KnowledgeReader, type OpenConfig } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const doc = (knowledgeId: string, file = `${knowledgeId}.md`): KnowledgeDocumentRef => ({ kind: "document", knowledgeId, role: "guide", locator: { type: "relative-file", path: file } });
const http: KnowledgeDocumentRef = { kind: "document", knowledgeId: "remote", role: "guide", locator: { type: "http", url: "https://example.test/doc" } };
const id = (capabilityId: string, providerId = "seed") => ({ providerId, capabilityId });
const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
async function fixture(run: (root: string) => Promise<void>) {
  const parent = await realpath(tmpdir()); const root = await mkdtemp(path.join(parent, "capability-graph-read-"));
  try { await run(root); } finally {
    assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("capability-graph-read-"));
    assert.equal(await realpath(root), root); await rm(root, { recursive: true, force: true });
  }
}
const config = (root: string, records: ReturnType<typeof record>[], extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
    const view = new FakeDatabase(records); view.knowledgeRootDir = root; return view;
  } } } }], ...extra,
});

test("local bytes are read on demand; body updates change contentId, not static revision", async () => fixture(async (root) => {
  await writeFile(path.join(root, "doc.md"), "first");
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [doc("doc")] })]));
  try {
    const first = await graph.readDocuments({ selected: [id("a")] });
    assert.ok(first.results[0]?.ok); assert.equal(first.results[0].value.source, "doc.md");
    await writeFile(path.join(root, "doc.md"), "changed");
    const next = await graph.readDocuments({ selected: [id("a")] });
    assert.ok(next.results[0]?.ok); assert.equal(next.results[0].value.text, "changed");
    assert.notEqual(next.results[0].value.contentId, first.results[0].value.contentId);
    assert.equal(first.meta.staticRevision, next.meta.staticRevision);
    assert.equal(JSON.stringify(next).includes(root), false);
  } finally { await graph.close(); }
}));

test("direct reads skip Collections unless explicitly named and retain per-item failures", async () => fixture(async (root) => {
  let retrievalCalls = 0;
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [doc("missing"), { kind: "collection", knowledgeId: "manual", members: [] }, http] }), record("b")], {
    knowledgeRetriever: { id: "fake", retrieve: async () => { retrievalCalls++; throw new Error("must not run"); } },
  }));
  try {
    const page = await graph.readDocuments({ selected: [id("a"), id("b")] });
    assert.deepEqual(page.results.map((slot) => slot.ok ? "ok" : slot.error.code), ["CG_SOURCE_UNREADABLE", "CG_READER_UNCONFIGURED", "CG_KNOWLEDGE_NOT_ASSOCIATED"]);
    assert.deepEqual(page.results.map((slot) => slot.inputIndex), [0, 1, 2]);
    assert.equal(page.meta.completeness, "partial"); assert.equal(retrievalCalls, 0);
    const collection = (await graph.readDocuments({ selected: [id("a")], knowledgeIds: ["manual"] })).results[0]!;
    assert.ok(!collection.ok); assert.equal(collection.error.code, "CG_KNOWLEDGE_TYPE_UNSUPPORTED");
    assert.equal(JSON.stringify(page).includes(root), false);
  } finally { await graph.close(); }
}));

test("known and unknown requested knowledge IDs both retain slots, in deterministic order", async () => fixture(async (root) => {
  await writeFile(path.join(root, "known.md"), "known");
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [doc("known")] })]));
  try {
    const page = await graph.forProvider("seed").readDocuments({ selected: ["a"], knowledgeIds: ["unknown", "known", "another"] });
    assert.equal(page.results.length, 3); assert.equal(page.results[0]?.ok, true);
    for (const slot of page.results.slice(1)) { assert.ok(!slot.ok); assert.equal(slot.error.code, "CG_NOT_FOUND"); }
    assert.throws(() => graph.readDocuments({ selected: [] }), code("CG_INPUT_INVALID"));
  } finally { await graph.close(); }
}));

test("read limits apply to expanded slots and complete document bytes, never a successful prefix", async () => fixture(async (root) => {
  await writeFile(path.join(root, "large.md"), "12345");
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [doc("large"), doc("other")] })], { budgets: { read: { maxBytes: 4, maxDocumentsPerCall: 1 } } }));
  try {
    await assert.rejects(graph.readDocuments({ selected: [id("a")] }), code("CG_BUDGET_EXCEEDED"));
    const page = await graph.readDocuments({ selected: [id("a")], knowledgeIds: ["large"] });
    assert.ok(!page.results[0]!.ok); assert.equal(page.results[0]!.error.code, "CG_BUDGET_EXCEEDED");
  } finally { await graph.close(); }
}));

test("Reader results are copied/projected and content identity/source are verified", async () => fixture(async (root) => {
  const bytes = new TextEncoder().encode("remote"); let mode = "good";
  const reader: KnowledgeReader = { id: "fake", canRead: () => true, read: async () => ({ bytes,
    contentId: mode === "hash" ? "k:bad" : contentId(bytes), contentType: "text/plain", source: mode === "source" ? root : "https://example.test/doc", internalRoot: root }) };
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [http] })], { readers: [reader] }));
  try {
    const good = await graph.readDocuments({ selected: [id("a")] }); assert.ok(good.results[0]?.ok);
    assert.equal(good.results[0].value.text, "remote"); assert.equal(JSON.stringify(good).includes(root), false);
    for (mode of ["hash", "source"]) { const page = await graph.readDocuments({ selected: [id("a")] });
      assert.ok(!page.results[0]!.ok); assert.equal(page.results[0]!.error.code, "CG_ADAPTER_CONTRACT_INVALID"); }
  } finally { await graph.close(); }
}));

test("default local reader wins; broken remote reader does not block static or local operations", async () => fixture(async (root) => {
  await writeFile(path.join(root, "doc.md"), "local");
  const reader: KnowledgeReader = { id: "broken", canRead: () => true, read: async () => { throw new Error(root); } };
  const graph = await CapabilityGraph.open(config(root, [record("a", { knowledge: [doc("doc"), http] })], { readers: [reader] }));
  try {
    const page = await graph.readDocuments({ selected: [id("a")] }); assert.ok(page.results[0]?.ok); assert.ok(!page.results[1]?.ok);
    assert.equal(page.results[1]!.error.code, "CG_READER_UNAVAILABLE"); assert.equal(JSON.stringify(page).includes(root), false);
    assert.equal((await graph.listCatalog()).items.length, 1);
  } finally { await graph.close(); }
}));

test("read rechecks jail after load and rejects a newly created outside junction", async () => fixture(async (root) => {
  const inside = path.join(root, "inside"); const outside = path.join(root, "outside");
  await mkdir(inside); await mkdir(outside); await writeFile(path.join(outside, "doc.md"), "outside");
  const graph = await CapabilityGraph.open(config(inside, [record("a", { knowledge: [doc("doc", "link/doc.md")] })]));
  try {
    await symlink(outside, path.join(inside, "link"), process.platform === "win32" ? "junction" : "dir");
    const page = await graph.readDocuments({ selected: [id("a")] }); assert.ok(!page.results[0]!.ok);
    assert.equal(page.results[0]!.error.code, "CG_PATH_TRAVERSAL");
    assert.equal((await graph.listCatalog()).items.length, 1);
  } finally { await graph.close(); }
}));

test("previous and current read their own roots, not cwd or latest configuration", async () => fixture(async (root) => {
  const oldRoot = path.join(root, "old"); const newRoot = path.join(root, "new"); await mkdir(oldRoot); await mkdir(newRoot);
  await writeFile(path.join(oldRoot, "doc.md"), "old"); await writeFile(path.join(newRoot, "doc.md"), "new");
  let version = 0;
  const initial = config(root, []);
  const graph = await CapabilityGraph.open({ ...initial, providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
    const db = new FakeDatabase([record("a", { name: String(version), knowledge: [doc("doc")] })]); db.knowledgeRootDir = version ? newRoot : oldRoot; return db;
  } } } }] });
  try {
    const old = (await graph.getProvider("seed")).staticRevision; version++; await graph.reload();
    const previous = await graph.readDocuments({ selected: [id("a")], requiredStaticRevision: old });
    const current = await graph.readDocuments({ selected: [id("a")] });
    assert.ok(previous.results[0]?.ok); assert.ok(current.results[0]?.ok);
    assert.equal(previous.results[0].value.text, "old"); assert.equal(current.results[0].value.text, "new"); assert.equal(previous.meta.servedFrom, "previous");
  } finally { await graph.close(); }
}));
