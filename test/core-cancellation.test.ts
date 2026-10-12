import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, type KnowledgeDocumentRef, type KnowledgeReader } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FileFixture, record } from "./contract/file-fixture.js";

const remote = (knowledgeId: string): KnowledgeDocumentRef => ({ kind: "document", knowledgeId, role: "guide",
  locator: { type: "http", url: `https://example.test/${knowledgeId}` } });
const id = { providerId: "seed", capabilityId: "a" };
async function open(reader?: KnowledgeReader) {
  const source = new FileFixture([record("a", { knowledge: [remote("one"), remote("two")] })]);
  source.provider = { ...source.provider, specification: { specificationId: "spec", version: "1",
    documents: [{ ...remote("spec-one"), role: "specification" }, { ...remote("spec-two"), role: "specification" }] } };
  return CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: source.authority }], ...(reader ? { readers: [reader] } : {}) });
}

test("configuration scope is immutable and detail metadata follows the requested scope", async () => {
  const graph = await open();
  try {
    const scope = graph.getProviderScope(); assert.deepEqual(scope, ["seed"]); assert(Object.isFrozen(scope));
    const empty = await graph.getCapabilities([id], { requestProviderScope: [] });
    assert.deepEqual(empty.meta.scope, []); assert(!empty.results[0]!.ok);
    assert.equal(empty.results[0]!.error.code, "CG_SCOPE_DENIED");
    await assert.rejects(graph.getCapabilities([id], { requestProviderScope: ["outside"] }), { code: "CG_SCOPE_DENIED" });
    assert.throws(() => graph.forProvider("seed").getCapabilities(["a"], { requestProviderScope: [] } as never), { code: "CG_INPUT_INVALID" });
  } finally { await graph.close(); }
});

test("all four body APIs reject pre-aborted work before Reader matching or I/O", async () => {
  let calls = 0;
  const reader: KnowledgeReader = { id: "count", canRead: () => { calls++; return true; }, read: async () => { throw new Error("unreachable"); } };
  const graph = await open(reader); const controller = new AbortController(); controller.abort(new Error("custom host reason"));
  try {
    for (const target of [graph, graph.forProvider("seed")]) {
      const bound = target !== graph;
      const queries = [
        () => target.readDocuments({ selected: bound ? ["a"] : [id], signal: controller.signal } as never),
        () => target.readDocumentPage({ ...(bound ? { capabilityId: "a" } : { capability: id }), knowledgeId: "one", signal: controller.signal } as never),
        () => target.readSpecification({ ...(bound ? {} : { providerId: "seed" }), signal: controller.signal } as never),
        () => target.readSpecificationPage({ ...(bound ? {} : { providerId: "seed" }), knowledgeId: "one", signal: controller.signal } as never),
      ];
      for (const query of queries) assert.throws(query, { name: "AbortError" });
    }
    assert.equal(calls, 0);
  } finally { await graph.close(); }
});

test("mid-batch cancellation waits for Reader cleanup, rejects the whole query and never reads the next slot", async () => {
  for (const specification of [false, true]) {
    const controller = new AbortController(); let calls = 0; let cleaned = false;
    const reader: KnowledgeReader = { id: "cancel", canRead: () => true, read: async (_ref, _context, budget) => {
      calls++; assert.equal(budget.signal, controller.signal);
      try { controller.abort("custom host reason"); budget.signal!.throwIfAborted(); throw new Error("unreachable"); }
      finally { await new Promise(resolve => setImmediate(resolve)); cleaned = true; }
    } };
    const graph = await open(reader);
    try {
      await assert.rejects(specification ? graph.readSpecification({ providerId: "seed", signal: controller.signal }) :
        graph.readDocuments({ selected: [id], signal: controller.signal }), { name: "AbortError" });
      assert.equal(calls, 1); assert.equal(cleaned, true);
    } finally { await graph.close(); }
  }
});

test("a legacy Reader ignoring signal is awaited, then its result is discarded on cancellation", async () => {
  const controller = new AbortController(); let returned = false;
  const bytes = Buffer.from("legacy");
  const reader: KnowledgeReader = { id: "legacy", canRead: () => true, read: async ref => {
    controller.abort(); await new Promise(resolve => setImmediate(resolve)); returned = true;
    return { bytes, contentId: contentId(bytes), contentType: "text/plain", source: ref.locator.type === "http" ? ref.locator.url : "" };
  } };
  const graph = await open(reader);
  try { await assert.rejects(graph.readDocumentPage({ capability: id, knowledgeId: "one", signal: controller.signal }), { name: "AbortError" }); assert(returned); }
  finally { await graph.close(); }
});
