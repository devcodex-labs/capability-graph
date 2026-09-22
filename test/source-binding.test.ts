import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, type OpenConfig } from "../src/index.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const selected = [{ providerId: "seed", capabilityId: "a" }];
const knowledge = [{ kind: "document", knowledgeId: "doc", role: "guide", locator: { type: "relative-file", path: "doc.md" } }];
const databaseConfig = (openView: () => Promise<FakeDatabase>): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView } } }],
});

async function fixture(run: (a: string, b: string) => Promise<void>) {
  const cwd = process.cwd(); const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "capability-graph-root-"));
  try {
    for (const name of ["a", "b"]) {
      const provider = path.join(root, name, "provider"); await mkdir(provider, { recursive: true });
      await writeFile(path.join(provider, "provider.json"), JSON.stringify({ providerId: "seed", name, version: "1" }));
      await writeFile(path.join(provider, "a.capability.json"), JSON.stringify(record("a", { knowledge })));
      await writeFile(path.join(provider, "doc.md"), `${name}-body`);
    }
    await run(path.join(root, "a"), path.join(root, "b"));
  } finally {
    process.chdir(cwd);
    assert.equal(path.dirname(root), parent); assert.equal(await realpath(root), root);
    assert.ok(path.basename(root).startsWith("capability-graph-root-"));
    await rm(root, { recursive: true, force: true });
  }
}
async function body(graph: CapabilityGraph, requiredStaticRevision?: string) {
  const page = await graph.readDocuments({ selected, requiredStaticRevision });
  const item = page.results[0]!; assert.ok(item.ok, JSON.stringify(page));
  assert.equal(item.value.source, "doc.md");
  return item.value.text;
}

test("deep R1: every enabled provider needs one authority before any source is opened", async () => {
  let opens = 0;
  const base = databaseConfig(async () => { opens++; return new FakeDatabase([record("a")]); });
  await assert.rejects(CapabilityGraph.open({ ...base, providers: [] }), { code: "CG_CONFIG_INCOMPLETE" });
  await assert.rejects(CapabilityGraph.open({ ...base, hostAllowedProviders: ["seed", "other"], integrationEnabledProviders: ["seed", "other"] }),
    { code: "CG_CONFIG_INCOMPLETE" });
  await assert.rejects(CapabilityGraph.open({ ...base, providers: [...base.providers, ...base.providers] }), { code: "CG_DUAL_AUTHORITY" });
  assert.equal(opens, 0);
  const empty = await CapabilityGraph.open({ ...base, integrationEnabledProviders: [], providers: [] });
  try { assert.deepEqual((await empty.listCatalog()).meta.scope, []); } finally { await empty.close(); }
  const enabled = await CapabilityGraph.open({ ...base, hostAllowedProviders: ["seed", "other"] });
  try { assert.deepEqual((await enabled.listCatalog()).meta.scope, ["seed"]); } finally { await enabled.close(); }
  assert.equal(opens, 1);
});

test("deep R2: file authority stays at its open-time root across cwd changes and reload", async () => fixture(async (a, b) => {
  process.chdir(a);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: { kind: "file", rootDir: "./provider" } }] });
  try {
    const revision = (await graph.getProvider("seed")).staticRevision;
    process.chdir(b); assert.equal(await body(graph), "a-body");
    await writeFile(path.join(a, "provider/a.capability.json"), JSON.stringify(record("a", { knowledge, name: "updated" })));
    assert.equal((await graph.reload()).ok, true);
    assert.equal(await body(graph), "a-body"); assert.equal(await body(graph, revision), "a-body");
    assert.notEqual((await graph.getProvider("seed")).staticRevision, revision);
    assert.equal((await graph.getProvider("seed")).name, "a");
    assert.equal(JSON.stringify(await graph.getCapabilities(selected)).includes(a), false);
  } finally { await graph.close(); }
}));

test("deep R2: database current and previous retain their own normalized roots", async () => fixture(async (a, b) => {
  let name = "first"; process.chdir(a);
  const graph = await CapabilityGraph.open(databaseConfig(async () => {
    const db = new FakeDatabase([record("a", { knowledge, name })]); db.knowledgeRootDir = "./provider"; return db;
  }));
  try {
    const revision = (await graph.getProvider("seed")).staticRevision;
    process.chdir(b); assert.equal(await body(graph), "a-body");
    name = "second"; assert.equal((await graph.reload()).ok, true);
    process.chdir(a);
    assert.equal(await body(graph), "b-body"); assert.equal(await body(graph, revision), "a-body");
    assert.equal(JSON.stringify(await graph.readDocuments({ selected })).includes(b), false);
  } finally { await graph.close(); }
}));

test("deep R2: validation awaits cannot rebase a relative root; declaration mutation still fails", async () => fixture(async (a, b) => {
  process.chdir(a);
  const db = new FakeDatabase([record("a", { knowledge })]); db.knowledgeRootDir = "./provider";
  db.onScan = () => process.chdir(b);
  const graph = await CapabilityGraph.open(databaseConfig(async () => db));
  try {
    assert.equal(process.cwd(), b); assert.equal(await body(graph), "a-body");
    db.knowledgeRootDir = "changed-root";
    await assert.rejects(graph.getProvider("seed"), { code: "CG_ADAPTER_CONTRACT_INVALID" });
  } finally { await graph.close(); }
}));
