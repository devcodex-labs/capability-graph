import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError } from "../src/index.js";
import { seedProviderRoot } from "../examples/seed-api/main.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { fakeKnowledgeRetriever } from "./contract/fake-knowledge-retriever.js";

const local = { providerId: "seed.http", capabilityId: "route.http" };
const remote = { providerId: "seed", capabilityId: "a" };
const code = (value: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === value;

test("R1: unrelated offline authority does not block local discovery or knowledge; mixed slots stay aligned", async () => {
  const db = new FakeDatabase([record("a")]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http", "seed"], integrationEnabledProviders: ["seed.http", "seed"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: seedProviderRoot } },
      { providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => db } } }],
    knowledgeRetriever: fakeKnowledgeRetriever });
  try {
    const revision = (await graph.getProvider("seed")).staticRevision;
    let failedReads = 0;
    db.getCapability = async () => { failedReads++; throw new Error("private offline reason"); };
    for (const result of [await graph.getCapabilities([local]), await graph.forProvider("seed.http").getCapabilities([local.capabilityId]),
      await graph.readDocuments({ selected: [local] })]) assert.equal(result.results[0]?.ok, true);
    assert.equal((await graph.queryKnowledge({ text: "find", selected: [local] })).items.length, 1);
    assert.equal(failedReads, 0);
    for (const result of [await graph.getCapabilities([local, remote, local]), await graph.readDocuments({ selected: [local, remote, local] })]) {
      assert.deepEqual(result.results.map((slot) => slot.ok ? "ok" : slot.error.code), ["ok", "CG_NO_ACTIVE_VIEW", "ok"]);
      assert.deepEqual(result.results.map((slot) => slot.inputIndex), [0, 1, 2]);
      assert.equal(result.meta.completeness, "partial");
    }
    const knowledge = await graph.queryKnowledge({ text: "find", selected: [local, remote] });
    assert.equal(knowledge.items.length, 1); assert.equal(knowledge.meta.warnings[0]?.code, "CG_NO_ACTIVE_VIEW");
    const denied = await graph.getCapabilities([{ providerId: "outside", capabilityId: "a" }]);
    assert.ok(!denied.results[0]?.ok); assert.equal(denied.results[0]?.error.code, "CG_SCOPE_DENIED");
    await assert.rejects(graph.listCatalog(), code("CG_NO_ACTIVE_VIEW"));
    await assert.rejects(graph.listProviders(), code("CG_NO_ACTIVE_VIEW"));
    await assert.rejects(graph.getCapabilities([remote], { requiredStaticRevision: revision }), code("CG_REVISION_MISMATCH"));
    await assert.rejects(graph.readDocuments({ selected: [remote], requiredStaticRevision: revision }), code("CG_REVISION_MISMATCH"));
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [remote], requiredStaticRevision: revision }), code("CG_REVISION_MISMATCH"));
  } finally { await graph.close(); }
});

test("R7: canonical and bound Provider results preserve current, failed refresh and previous metadata", async () => {
  const old = new FakeDatabase([record("a")]); const current = new FakeDatabase([record("a", { name: "new" })]);
  let source = old; let fail = false;
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
      if (fail) throw new Error("private failure"); return source;
    } } } }] });
  try {
    const bound = graph.forProvider("seed"); const before = await graph.getProvider("seed");
    assert.equal(before.meta.servedFrom, "current"); assert.equal(before.meta.staticRevision, before.staticRevision);
    assert.equal(before.meta.refreshFailed, undefined); assert.deepEqual(before.meta.scope, ["seed"]);
    source = current; await graph.reload(); fail = true; await graph.reload();
    for (const read of [() => graph.getProvider("seed"), () => bound.getProvider()]) {
      const result = await read(); assert.equal(result.meta.refreshFailed, true); assert.equal(result.meta.servedFrom, "current");
    }
    for (const read of [() => graph.getProvider("seed", { requiredStaticRevision: before.staticRevision }),
      () => bound.getProvider({ requiredStaticRevision: before.staticRevision })]) {
      const result = await read(); assert.equal(result.meta.servedFrom, "previous"); assert.equal(result.meta.refreshFailed, true);
      assert.equal(result.staticRevision, before.staticRevision);
    }
    old.getCapability = async () => { throw new Error("expired"); };
    await assert.rejects(bound.getProvider({ requiredStaticRevision: before.staticRevision }), code("CG_REVISION_MISMATCH"));
    current.getCapability = async () => { throw new Error("offline"); };
    await assert.rejects(graph.getProvider("seed"), code("CG_NO_ACTIVE_VIEW"));
    await assert.rejects(bound.getProvider(), code("CG_NO_ACTIVE_VIEW"));
  } finally { await graph.close(); }
});
