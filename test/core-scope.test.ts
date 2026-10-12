import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, type OpenConfig } from "../src/index.js";
import { DEFAULT_BUDGETS } from "../src/budgets.js";
import { FileFixture, record } from "./contract/file-fixture.js";

test("2.0 rejects removed integrations even when explicitly undefined", async () => {
  const fixture = new FileFixture([record("a")]);
  const base: OpenConfig = { hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: fixture.authority }] };
  for (const field of ["runtimeAdapters", "knowledgeRetriever", "capabilityRetriever"]) {
    for (const value of [undefined, [], { id: "old" }]) await assert.rejects(CapabilityGraph.open({ ...base, [field]: value }),
      (error: unknown) => { assert(error instanceof Error); assert.equal((error as { code?: string }).code, "CG_CONFIG_INCOMPLETE"); assert.match(error.message, new RegExp(field)); return true; });
  }
  await assert.rejects(CapabilityGraph.open({ ...base, providers: [{ providerId: "seed", authority: { kind: "database", adapter: {} } }] } as never),
    { code: "CG_CONFIG_INCOMPLETE" });
  for (const group of ["runtime", "queryKnowledge", "retrieveCapabilities"]) {
    for (const value of [undefined, {}]) await assert.rejects(CapabilityGraph.open({ ...base, budgets: { [group]: value } }), { code: "CG_CONFIG_INCOMPLETE" });
    assert.equal(group in DEFAULT_BUDGETS, false);
  }
  const graph = await CapabilityGraph.open(base);
  try {
    for (const target of [graph, graph.forProvider("seed")]) for (const name of ["queryRuntime", "queryKnowledge", "retrieveCapabilities"])
      assert.equal(name in target, false);
    assert.equal((await graph.getProvider("seed")).authorityKind, "file");
  } finally { await graph.close(); }
});
