import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type KnowledgeRetriever, type OpenConfig } from "../src/index.js";
import { seedProviderRoot } from "../examples/seed-api/main.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const id = { providerId: "seed", capabilityId: "a" };
const local = { providerId: "seed.http", capabilityId: "route.http" };
const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
async function removeTemporary(directory: string): Promise<void> {
  const resolved = await realpath(directory);
  assert.equal(path.dirname(resolved), await realpath(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("cg-review-"));
  await rm(resolved, { recursive: true, force: true });
  await assert.rejects(realpath(resolved), { code: "ENOENT" });
}
const config = (db: FakeDatabase, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => db } } }], ...extra,
});

test("R9: mixed recall retains file candidates and original ranks when a database goes offline", async () => {
  const db = new FakeDatabase([record("a")]);
  const base = config(db);
  const graph = await CapabilityGraph.open({ ...base, hostAllowedProviders: ["seed", "seed.http"], integrationEnabledProviders: ["seed", "seed.http"],
    providers: [...base.providers, { providerId: "seed.http", authority: { kind: "file", rootDir: seedProviderRoot } }],
    capabilityRetriever: { id: "mixed", retrieve: async (input) => ({ candidates: [
      { id, sourceStaticRevision: input.staticRevisionByProvider.seed! },
      { id: local, sourceStaticRevision: input.staticRevisionByProvider["seed.http"]!, score: 0.7 },
    ] }) } });
  try {
    db.getCapability = async () => { throw new Error("private offline reason"); };
    const page = await graph.retrieveCapabilities({ text: "route" });
    assert.deepEqual(page.items.map((item) => [item.id, item.rank, item.score]), [[local, 2, 0.7]]);
    assert.equal(page.meta.warnings[0]?.code, "CG_NO_ACTIVE_VIEW"); assert.equal(page.meta.completeness, "partial");
    assert.doesNotMatch(JSON.stringify(page), /private offline reason/);
  } finally { await graph.close(); }
});

test("R9: pinned current and previous views failing during recall are query failures", async () => {
  for (const previous of [false, true]) {
    const db = new FakeDatabase([record("a")]); let source = db; let calls = 0;
    const graph = await CapabilityGraph.open(config(db, {
      providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => source } } }],
      capabilityRetriever: { id: "expire-during-recall", retrieve: async (input) => {
        calls++; db.getCapability = async () => { throw new Error("expired"); };
        return { candidates: [{ id, sourceStaticRevision: input.staticRevisionByProvider.seed! }] };
      } },
    }));
    try {
      const revision = (await graph.getProvider("seed")).staticRevision;
      if (previous) { source = new FakeDatabase([record("a", { name: "new" })]); await graph.reload(); }
      await assert.rejects(graph.retrieveCapabilities({ text: "find", requiredStaticRevision: revision }), code("CG_REVISION_MISMATCH"));
      assert.equal(calls, 1);
      await assert.rejects(graph.retrieveCapabilities({ text: "find", requiredStaticRevision: revision }), code("CG_REVISION_MISMATCH"));
      assert.equal(calls, 1, "already unreadable view fails before calling the retriever");
    } finally { await graph.close(); }
  }
});

test("R9: stale candidate revisions remain item warnings even in an explicitly pinned query", async () => {
  const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a")]), {
    capabilityRetriever: { id: "stale-candidate", retrieve: async (input) => ({ candidates: [
      { id, sourceStaticRevision: "s:old" }, { id, sourceStaticRevision: input.staticRevisionByProvider.seed! },
    ] }) },
  }));
  try {
    const revision = (await graph.getProvider("seed")).staticRevision;
    const page = await graph.retrieveCapabilities({ text: "find", requiredStaticRevision: revision });
    assert.equal(page.items[0]?.rank, 2); assert.equal(page.meta.warnings[0]?.code, "CG_REVISION_MISMATCH");
  } finally { await graph.close(); }
});

const remoteDocument = { kind: "document", knowledgeId: "intro", role: "guide", locator: { type: "http", url: "https://example.test/intro" } };
test("S1: Core access errors retain safe diagnostics even if the retriever mutates and rethrows them", async () => {
  for (const mutate of [false, true]) {
    const retriever: KnowledgeRetriever = { id: "invalid-target", retrieve: async (_input, access) => {
      try { await access.read({ id, knowledgeId: "unselected" }, { maxBytes: 100 }); }
      catch (error) {
        if (mutate) Object.assign(error as object, { details: { reason: "C:/private/root" }, nextAction: "private-action", code: "CG_READER_UNAVAILABLE" });
        throw error;
      }
      throw new Error("unexpected successful read");
    } };
    const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a", { knowledge: [remoteDocument] })]), { knowledgeRetriever: retriever }));
    try {
      await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id] }), (error: unknown) => {
        assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_ADAPTER_CONTRACT_INVALID");
        assert.equal(error.nextAction, "repair_source"); assert.deepEqual(error.details, { reason: "retrieval_target_not_selected" }); return true;
      });
    } finally { await graph.close(); }
  }
});

test("S1: local read failures retain the declared relative path at the public query boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cg-review-read-"));
  const db = new FakeDatabase([record("a", { knowledge: [{ kind: "document", knowledgeId: "intro", role: "guide", locator: { type: "relative-file", path: "missing.md" } }] })]);
  db.knowledgeRootDir = root;
  let graph: CapabilityGraph | undefined;
  try {
    graph = await CapabilityGraph.open(config(db, { knowledgeRetriever: { id: "read-missing", retrieve: async (input, access) => {
      await access.read({ id, knowledgeId: input.targets[0]!.knowledgeId }, { maxBytes: 100 }); throw new Error("unexpected success");
    } } }));
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id] }), (error: unknown) => {
      assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_SOURCE_UNREADABLE");
      assert.deepEqual(error.details, { path: "missing.md" }); assert.ok(!JSON.stringify(error).includes(root)); return true;
    });
  } finally { await graph?.close(); await removeTemporary(root); }
});

test("S1: a post-load junction escape retains only its declared relative path", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cg-review-jail-"));
  const root = path.join(temporary, "root"); const outside = path.join(temporary, "outside");
  let graph: CapabilityGraph | undefined;
  try {
    await mkdir(root); await mkdir(outside);
    const db = new FakeDatabase([record("a", { knowledge: [{ kind: "document", knowledgeId: "intro", role: "guide", locator: { type: "relative-file", path: "linked" } }] })]);
    db.knowledgeRootDir = root;
    graph = await CapabilityGraph.open(config(db, { knowledgeRetriever: { id: "read-escape", retrieve: async (_input, access) => {
      await access.read({ id, knowledgeId: "intro" }, { maxBytes: 100 }); throw new Error("unexpected success");
    } } }));
    await symlink(outside, path.join(root, "linked"), "junction");
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id] }), (error: unknown) => {
      assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_PATH_TRAVERSAL");
      assert.deepEqual(error.details, { path: "linked" }); assert.ok(!JSON.stringify(error).includes(temporary)); return true;
    });
  } finally { await graph?.close(); await removeTemporary(temporary); }
});

test("S1: forged adapter diagnostics stay stripped in both retrieval entry points", async () => {
  const fail = async (): Promise<never> => { throw new CapabilityGraphError("CG_PATH_TRAVERSAL", {
    nextAction: "repair_source", details: { path: "C:/private/root", reason: "private-adapter-reason" },
  }); };
  const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a", { knowledge: [remoteDocument] })]), {
    knowledgeRetriever: { id: "forged", retrieve: fail }, capabilityRetriever: { id: "forged", retrieve: fail },
  }));
  try {
    for (const call of [() => graph.queryKnowledge({ text: "find", selected: [id] }), () => graph.retrieveCapabilities({ text: "find" })]) {
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_PATH_TRAVERSAL"); assert.equal(error.details, undefined); return true;
      });
    }
  } finally { await graph.close(); }
});

test("R10: late Runtime rejection after timeout is handled under strict unhandled-rejection mode", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { CapabilityGraph } from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};
    import { FakeDatabase, record } from ${JSON.stringify(new URL("./contract/fake-database.js", import.meta.url).href)};
    let rejectAdapter;
    const graph = await CapabilityGraph.open({
      hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'],
      providers: [{ providerId: 'seed', authority: { kind: 'database', adapter: { id: 'fake', openView: async () => new FakeDatabase([record('a')]) } } }],
      budgets: { runtime: { timeoutMs: 10 } },
      runtimeAdapters: [{ id: 'late', providerId: 'seed', query: () => new Promise((_, reject) => { rejectAdapter = reject; }) }],
    });
    try {
      await assert.rejects(graph.queryRuntime({ project: 'demo', environment: 'test' }), { code: 'CG_RUNTIME_UNAVAILABLE' });
      rejectAdapter(new Error('late adapter failure'));
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal((await graph.listCatalog()).items.length, 1);
      console.log('late rejection handled');
    } finally { await graph.close(); }
  `;
  const options = { encoding: "utf8" as const, timeout: 15000, windowsHide: true };
  assert.match(execFileSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script], options), /late rejection handled/);
  // A positive control proves the child would fail if a rejection had no handler.
  assert.throws(() => execFileSync(process.execPath, ["--unhandled-rejections=strict", "-e", "Promise.reject(new Error('control'))"],
    { ...options, stdio: "pipe" }), (error: unknown) => (error as { status?: number }).status === 1);
});
