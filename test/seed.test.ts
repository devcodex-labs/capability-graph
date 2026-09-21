import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph } from "@devcodex/capability-graph";
import { runSeedTask, seedProviderRoot } from "../examples/seed-api/main.js";
import { seedRuntimeFixture } from "./contract/fixture-runtime-adapter.js";

test("Seed: real definitions and public API select only the two required documents", async () => {
  const result = await runSeedTask();
  assert.equal(result.catalog.items.length, 5); assert.equal(result.runtime, undefined);
  assert.equal(result.providers.items[0]?.specification?.entryRef?.type, "relative-file");
  assert.deepEqual(result.neighbors.groups.parents.items.map((entry) => entry.id.capabilityId), ["request", "route"]);
  assert.equal(result.neighbors.groups.specializes.items[0]?.id.capabilityId, "route.http");
  assert.equal(result.neighbors.groups.related.items[0]?.id.capabilityId, "schema.request");
  assert.deepEqual(result.documents.results.map((entry) => entry.ok ? entry.value.knowledgeId : entry.error.code), ["D-02", "D-03"]);
  assert.ok(result.documents.results.every((entry) => entry.ok && entry.value.text.length > 100));
  assert.equal(JSON.stringify(result).includes(seedProviderRoot), false);
});

test("Seed non-F-18: contract Runtime step uses a test-only fixture, not a claimed real source", async () => {
  const result = await runSeedTask({ runtime: { adapter: seedRuntimeFixture(), project: "project-a", environment: "test" } });
  assert.equal(result.runtime?.items[0]?.facts.path, "/users");
  assert.equal(result.runtime?.observation.source, "fixture://seed");
  assert.equal(result.catalog.items.length, 5);
});

test("Seed: second provider isolation and failed update recovery on actual author files", async () => {
  const parent = await realpath(tmpdir()); const root = await mkdtemp(path.join(parent, "capability-graph-seed-"));
  const first = path.join(root, "first"); const second = path.join(root, "second");
  try {
    await cp(seedProviderRoot, first, { recursive: true }); await cp(seedProviderRoot, second, { recursive: true });
    const provider = JSON.parse(await readFile(path.join(second, "provider.json"), "utf8")) as { providerId: string };
    provider.providerId = "seed.other"; await writeFile(path.join(second, "provider.json"), JSON.stringify(provider));
    const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http", "seed.other"], integrationEnabledProviders: ["seed.http", "seed.other"],
      providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: first } }, { providerId: "seed.other", authority: { kind: "file", rootDir: second } }] });
    try {
      assert.equal((await graph.listCatalog()).items.length, 10);
      assert.equal((await graph.forProvider("seed.other").listCatalog()).items.length, 5);
      const file = path.join(first, "route-validation.capability.json"); const original = await readFile(file, "utf8");
      const old = (await graph.getProvider("seed.http")).staticRevision;
      await writeFile(file, "{bad json"); assert.equal((await graph.reload({ providerId: "seed.http" })).ok, false);
      assert.equal((await graph.forProvider("seed.http").listCatalog()).meta.refreshFailed, true);
      assert.equal((await graph.forProvider("seed.other").listCatalog()).meta.refreshFailed, undefined);
      const changed = JSON.parse(original) as { name: string }; changed.name = "Updated display name";
      await writeFile(file, JSON.stringify(changed)); assert.equal((await graph.reload({ providerId: "seed.http" })).ok, true);
      assert.notEqual((await graph.getProvider("seed.http")).staticRevision, old);
      assert.equal((await graph.forProvider("seed.http").listCatalog({ requiredStaticRevision: old })).meta.servedFrom, "previous");
      assert.equal((await graph.forProvider("seed.http").listCatalog()).meta.refreshFailed, undefined);
    } finally { await graph.close(); }
  } finally {
    assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("capability-graph-seed-")); assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  }
});

test("Seed: identity replacement removes the old capability without deleting shared knowledge", async () => {
  const parent = await realpath(tmpdir()); const root = await mkdtemp(path.join(parent, "capability-graph-seed-identity-"));
  try {
    await cp(seedProviderRoot, root, { recursive: true });
    const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
      providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: root } }] });
    try {
      const file = path.join(root, "route-validation.capability.json");
      const replacement = JSON.parse(await readFile(file, "utf8")) as { capabilityId: string }; replacement.capabilityId = "route.check-input";
      await writeFile(path.join(root, "replacement.capability.json"), JSON.stringify(replacement)); await unlink(file);
      const schemaFile = path.join(root, "schema-request.capability.json");
      const schema = JSON.parse(await readFile(schemaFile, "utf8")) as { related: string[] }; schema.related = ["route.check-input"];
      await writeFile(schemaFile, JSON.stringify(schema));
      assert.equal((await graph.reload()).ok, true);
      const result = await graph.forProvider("seed.http").getCapabilities(["route.validation", "route.check-input"]);
      assert.equal(result.results[0]?.ok, false); assert.equal(result.results[1]?.ok, true);
      const document = await graph.forProvider("seed.http").readDocuments({ selected: ["route.check-input"] }); assert.ok(document.results[0]?.ok);
      assert.ok((await readFile(path.join(root, "knowledge/route-validation.md"), "utf8")).length > 100);
    } finally { await graph.close(); }
  } finally {
    assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith("capability-graph-seed-identity-")); assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  }
});
