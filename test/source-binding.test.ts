import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, type OpenConfig } from "../src/index.js";
import { FileFixture, record } from "./contract/file-fixture.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

const selected = [{ providerId: "seed", capabilityId: "a" }];
const knowledge = [{ kind: "document", knowledgeId: "doc", role: "guide", locator: { type: "relative-file", path: "doc.md" } }];

async function fixture(run: (a: string, b: string) => Promise<void>) {
  const cwd = process.cwd();
  const root = await createTestDirectory("capability-graph-root-");
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
    await removeTestDirectory(root);
  }
}
async function body(graph: CapabilityGraph, requiredStaticRevision?: string) {
  const page = await graph.readDocuments({ selected, requiredStaticRevision });
  const item = page.results[0]!; assert.ok(item.ok, JSON.stringify(page));
  assert.equal(item.value.source, "doc.md");
  return item.value.text;
}

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
