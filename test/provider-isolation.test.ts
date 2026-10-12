import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph } from "../src/index.js";
import { seedProviderRoot } from "../examples/seed-api/main.js";
import { FileFixture, record } from "./contract/file-fixture.js";

test("unrelated failed file refresh leaves other Provider queries and mixed slots intact", async () => {
  const fixture = new FileFixture([record("a")]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http", "seed"], integrationEnabledProviders: ["seed.http", "seed"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", definitionLayout: "directory", rootDir: seedProviderRoot } },
      { providerId: "seed", authority: fixture.authority }] });
  const local = { providerId: "seed.http", capabilityId: "route.http" }; const remote = { providerId: "seed", capabilityId: "a" };
  try {
    await writeFile(path.join(fixture.rootDir, "provider.json"), "invalid-json");
    assert.equal((await graph.reload({ providerId: "seed" })).ok, false);
    const details = await graph.getCapabilities([local, remote, local]);
    assert.deepEqual(details.results.map((slot) => slot.ok), [true, true, true]);
    assert.deepEqual(details.results.map((slot) => slot.inputIndex), [0, 1, 2]);
    assert.equal(details.meta.refreshFailed, true);
    const localRead = await graph.forProvider("seed.http").readDocuments({ selected: ["route.http"] });
    assert.equal(localRead.results[0]?.ok, true); assert.equal(localRead.meta.refreshFailed, undefined);
    const denied = await graph.getCapabilities([{ providerId: "outside", capabilityId: "a" }]);
    assert.ok(!denied.results[0]?.ok); assert.equal(denied.results[0]?.error.code, "CG_SCOPE_DENIED");
  } finally { await graph.close(); }
});

test("bound and canonical Provider queries preserve current, previous and failed refresh provenance", async () => {
  const fixture = new FileFixture([record("a")]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: fixture.authority }] });
  try {
    const bound = graph.forProvider("seed"); const before = await graph.getProvider("seed");
    fixture.records = [record("a", { name: "new" })]; fixture.sync(); await graph.reload();
    await writeFile(path.join(fixture.rootDir, "provider.json"), "invalid-json"); await graph.reload();
    for (const read of [() => graph.getProvider("seed"), () => bound.getProvider()]) {
      const value = await read(); assert.equal(value.meta.refreshFailed, true); assert.equal(value.meta.servedFrom, "current");
    }
    for (const read of [() => graph.getProvider("seed", { requiredStaticRevision: before.staticRevision }),
      () => bound.getProvider({ requiredStaticRevision: before.staticRevision })]) {
      const value = await read(); assert.equal(value.meta.servedFrom, "previous"); assert.equal(value.meta.refreshFailed, true);
      assert.equal(value.staticRevision, before.staticRevision);
    }
  } finally { await graph.close(); }
});
