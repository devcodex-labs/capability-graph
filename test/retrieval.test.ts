import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type OpenConfig, type KnowledgeRetriever, type KnowledgeRetrievalAccess, type KnowledgeReader } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { fakeKnowledgeRetriever } from "./contract/fake-knowledge-retriever.js";

const id = (capabilityId = "a", providerId = "seed") => ({ providerId, capabilityId });
const document = (knowledgeId: string) => ({ kind: "document", knowledgeId, locator: { type: "http", url: `https://example.test/${knowledgeId}` } });
const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const reader: KnowledgeReader = { id: "fake-reader", canRead: () => true, read: async (ref) => {
  const bytes = new TextEncoder().encode(`text:${ref.knowledgeId}`);
  return { bytes, contentId: contentId(bytes), source: ref.locator.type === "http" ? ref.locator.url : ref.locator.path, contentType: "text/plain" };
} };
const defaultRecords = () => [record("a", { knowledge: [document("intro"), { kind: "collection", knowledgeId: "manual", members: [document("intro"), document("routing")] }] }), record("b"), record("empty", { knowledge: [{ kind: "collection", knowledgeId: "nothing", members: [] }] })];
const config = (extra: Partial<OpenConfig> = {}, records = defaultRecords()): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], readers: [reader],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
    const db = new FakeDatabase(records); db.knowledgeRootDir = "C:/private/knowledge-root"; return db;
  } } } }], ...extra,
});
const wrap = (run: (input: Parameters<KnowledgeRetriever["retrieve"]>[0], access: KnowledgeRetrievalAccess,
  result: Awaited<ReturnType<KnowledgeRetriever["retrieve"]>>) => Awaited<ReturnType<KnowledgeRetriever["retrieve"]>> | Promise<Awaited<ReturnType<KnowledgeRetriever["retrieve"]>>>): KnowledgeRetriever => ({
  id: "fake-modified", retrieve: async (input, access) => run(input, access, await fakeKnowledgeRetriever.retrieve(input, access)),
});

test("R8: all-invalid selections retain their cause, with bounded mixed failure details", async () => {
  for (const configured of [false, true]) {
    const graph = await CapabilityGraph.open(config(configured ? { knowledgeRetriever: fakeKnowledgeRetriever } : {}));
    try {
      for (const [selected, expected, action] of [
        [[id("a", "outside")], "CG_SCOPE_DENIED", "narrow_scope"],
        [[{ capabilityId: "a" }], "CG_IDENTITY_AMBIGUOUS", "fix_input"],
        [[null], "CG_IDENTITY_INVALID", "fix_input"],
        [[id("missing")], "CG_NOT_FOUND", "fix_input"],
        [[id("a", "outside"), id("a", "outside")], "CG_SCOPE_DENIED", "narrow_scope"],
      ] as const) {
        await assert.rejects(graph.queryKnowledge({ text: "find", selected: selected as never }), (error: unknown) => {
          assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, expected); assert.equal(error.nextAction, action);
          assert.equal(error.details?.failureCount, selected.length); return true;
        });
      }
      await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id("a", "outside"), ...Array.from({ length: 25 }, () => ({ capabilityId: "a" }))] }), (error: unknown) => {
        assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_PARTIAL_ITEM");
        assert.equal(error.details?.failureCount, 26); assert.equal(error.details?.omittedFailureCount, 6);
        const failures = error.details?.failures as { inputIndex: number; code: string }[];
        assert.equal(failures.length, 20); assert.equal(failures[0]?.code, "CG_SCOPE_DENIED");
        assert.deepEqual(failures.map((item) => item.inputIndex), Array.from({ length: 20 }, (_, i) => i));
        assert.doesNotMatch(JSON.stringify(error), /outside/); return true;
      });
      if (configured) {
        const page = await graph.queryKnowledge({ text: "find", selected: [id("a", "outside"), id()] });
        assert.equal(page.items.length, 2); assert.equal(page.meta.warnings[0]?.code, "CG_SCOPE_DENIED");
        assert.equal(page.meta.completeness, "partial");
      }
    } finally { await graph.close(); }
  }
});

test("retrieval unavailable differs from no knowledge, empty collection, filtered empty and no match", async () => {
  let calls = 0;
  const graph = await CapabilityGraph.open(config({ knowledgeRetriever: wrap((_input, _access, result) => { calls++; return result; }) }));
  try {
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id("b")] }), code("CG_KNOWLEDGE_NOT_ASSOCIATED"));
    assert.equal((await graph.queryKnowledge({ text: "find", selected: [id("empty")] })).knowledgeState, "empty_collection");
    const filtered = await graph.queryKnowledge({ text: "find", selected: [id()], knowledgeIds: ["missing"] });
    assert.equal(filtered.knowledgeState, "filtered_empty"); assert.equal(filtered.meta.completeness, "partial"); assert.equal(calls, 0);
    const none = await graph.queryKnowledge({ text: "no-match", selected: [id()] });
    assert.equal(none.knowledgeState, "searched"); assert.equal(none.items.length, 0); assert.equal(none.indexStatus?.validatedDocuments, 2); assert.equal(calls, 1);
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id()], knowledgeIds: [] }), code("CG_INPUT_INVALID"));
  } finally { await graph.close(); }
  const disabled = await CapabilityGraph.open(config());
  try {
    await assert.rejects(disabled.queryKnowledge({ text: "find", selected: [id("b")] }), code("CG_KNOWLEDGE_NOT_ASSOCIATED"));
    await assert.rejects(disabled.queryKnowledge({ text: "find", selected: [id("empty")] }), code("CG_RETRIEVER_UNCONFIGURED"));
    await assert.rejects(disabled.retrieveCapabilities({ text: "find" }), code("CG_RETRIEVER_UNCONFIGURED"));
  } finally { await disabled.close(); }
});

test("capability candidates are verified without reordering scores or compacting original ranks", async () => {
  const graph = await CapabilityGraph.open(config({ capabilityRetriever: { id: "fake", retrieve: async (input) => ({ candidates: [
    { id: id(), score: 0.1, sourceStaticRevision: input.staticRevisionByProvider.seed! },
    { id: id("a", "outside"), score: 0.9, sourceStaticRevision: "fake" },
    { id: id("b"), score: 0.7, sourceStaticRevision: input.staticRevisionByProvider.seed! },
    { id: id("missing"), sourceStaticRevision: input.staticRevisionByProvider.seed! },
    { id: id(), sourceStaticRevision: input.staticRevisionByProvider.seed! },
  ] }) } }));
  try {
    const page = await graph.retrieveCapabilities({ text: "find" });
    assert.deepEqual(page.items.map((entry) => [entry.id.capabilityId, entry.rank, entry.score]), [["a", 1, 0.1], ["b", 3, 0.7]]);
    assert.equal(page.meta.completeness, "partial"); assert.equal(page.meta.warnings.length, 3);
    assert.equal(JSON.stringify(page.meta.warnings).includes("outside"), false);
    await assert.rejects(graph.retrieveCapabilities({ text: "find", limit: 1 }), code("CG_ADAPTER_CONTRACT_INVALID"));
  } finally { await graph.close(); }
});

test("Collection and member selections deduplicate composite targets and never transmit readContext", async () => {
  const graph = await CapabilityGraph.open(config({ knowledgeRetriever: wrap((input, access, result) => {
    assert.deepEqual(input.targets.map((target) => target.knowledgeId), ["intro", "routing"]);
    assert.deepEqual(input.targets[0]?.viaCollectionIds, ["manual"]);
    assert.equal(JSON.stringify(input).includes("knowledge-root"), false); assert.equal(JSON.stringify(input).includes("readContext"), false);
    assert.deepEqual(Object.keys(access), ["read"]); return result;
  }) }));
  try {
    const page = await graph.queryKnowledge({ text: "find", selected: [id(), id()], knowledgeIds: ["manual", "intro"] });
    assert.equal(page.items.length, 2); assert.equal(page.meta.completeness, "complete");
    assert.equal("evidence" in page, false); assert.equal(JSON.stringify(page).includes("knowledge-root"), false);
  } finally { await graph.close(); }
});

test("member-only selection stays narrow; missing associations and unknown filters produce partial", async () => {
  const graph = await CapabilityGraph.open(config({ knowledgeRetriever: wrap((input, _access, result) => {
    assert.deepEqual(input.targets.map((target) => target.knowledgeId), ["intro"]); return result;
  }) }));
  try {
    const page = await graph.queryKnowledge({ text: "find", selected: [id(), id("b")], knowledgeIds: ["intro", "unknown"] });
    assert.equal(page.items.length, 1); assert.equal(page.meta.completeness, "partial");
    assert.deepEqual(page.meta.warnings.map((entry) => entry.code), ["CG_KNOWLEDGE_NOT_ASSOCIATED", "CG_NOT_FOUND"]);
  } finally { await graph.close(); }
});

test("zero-hit results still require complete fresh evidence and exact static revisions", async () => {
  type Result = Awaited<ReturnType<KnowledgeRetriever["retrieve"]>>;
  const mutations: [string, (result: Result) => Result, string][] = [
    ["missing", (r) => ({ ...r, evidence: undefined as never }), "CG_INDEX_STALE"],
    ["stale", (r) => ({ ...r, evidence: { ...r.evidence, freshness: "stale" } }), "CG_INDEX_STALE"],
    ["unknown", (r) => ({ ...r, evidence: { ...r.evidence, freshness: "unknown" } }), "CG_INDEX_STALE"],
    ["mapping", (r) => ({ ...r, evidence: { ...r.evidence, mappingRevision: "old" } }), "CG_INDEX_STALE"],
    ["config", (r) => ({ ...r, evidence: { ...r.evidence, indexedConfigRevision: "old" } }), "CG_INDEX_STALE"],
    ["missing document", (r) => ({ ...r, evidence: { ...r.evidence, documents: r.evidence.documents.slice(1) } }), "CG_INDEX_STALE"],
    ["duplicate", (r) => ({ ...r, evidence: { ...r.evidence, documents: [r.evidence.documents[0]!, r.evidence.documents[0]!] } }), "CG_INDEX_STALE"],
    ["content", (r) => ({ ...r, evidence: { ...r.evidence, documents: r.evidence.documents.map((doc) => ({ ...doc, sourceContentId: "k:0000000000000000" })) } }), "CG_INDEX_STALE"],
    ["time", (r) => ({ ...r, evidence: { ...r.evidence, observedAt: "not a date" } }), "CG_INDEX_STALE"],
    ["revision", (r) => ({ ...r, evidence: { ...r.evidence, staticRevisionByProvider: { seed: "old" } } }), "CG_REVISION_MISMATCH"],
  ];
  for (const [name, mutate, expected] of mutations) {
    const graph = await CapabilityGraph.open(config({ knowledgeRetriever: wrap((_input, _access, result) => mutate(result)) }));
    try { await assert.rejects(graph.queryKnowledge({ text: "no-match", selected: [id()] }), code(expected), name); }
    finally { await graph.close(); }
  }
});

test("hit scope, content, offset and snippet budgets are checked; public output omits extra fields", async () => {
  const graph = await CapabilityGraph.open(config({ budgets: { queryKnowledge: { maxSnippetBytes: 20 } }, knowledgeRetriever: wrap((_input, _access, result) => ({ ...result, hits: [
    { ...result.hits[0]!, internalRoot: "C:/private" },
    { ...result.hits[0]!, knowledgeId: "unselected" },
    { ...result.hits[0]!, endOffset: 999 },
    { ...result.hits[0]!, snippet: "x".repeat(21), endOffset: 21 },
  ] })) }));
  try {
    const page = await graph.queryKnowledge({ text: "find", selected: [id()] });
    assert.equal(page.items.length, 1); assert.equal(page.meta.warnings.length, 3); assert.equal(page.meta.completeness, "partial");
    assert.equal(JSON.stringify(page).includes("internalRoot"), false);
    assert.equal(page.meta.warnings[2]?.code, "CG_BUDGET_EXCEEDED");
  } finally { await graph.close(); }
});

test("access checks composite whitelist, disallows source overrides and expires at completion", async () => {
  let saved: KnowledgeRetrievalAccess | undefined;
  const graph = await CapabilityGraph.open(config({ knowledgeRetriever: { id: "fake", retrieve: async (input, access) => {
    saved = access;
    await assert.rejects(access.read({ id: id("a", "outside"), knowledgeId: "intro" }, { maxBytes: 100 }), code("CG_SCOPE_DENIED"));
    await assert.rejects(access.read({ id: id("b"), knowledgeId: "intro" }, { maxBytes: 100 }), code("CG_ADAPTER_CONTRACT_INVALID"));
    await assert.rejects(access.read({ id: id(), knowledgeId: "intro", locator: { type: "relative-file", path: "outside" } } as never, { maxBytes: 100 }), code("CG_ADAPTER_CONTRACT_INVALID"));
    return fakeKnowledgeRetriever.retrieve(input, access);
  } } }));
  try {
    await graph.queryKnowledge({ text: "find", selected: [id()] });
    await assert.rejects(saved!.read({ id: id(), knowledgeId: "intro" }, { maxBytes: 100 }), (error: unknown) =>
      error instanceof CapabilityGraphError && error.details?.reason === "retrieval_access_expired");
  } finally { await graph.close(); }
});

test("mapping changes with root but not description; previous retrieval receives its own revision", async () => {
  let name = "first"; let root = "C:/private/one"; const mappings: string[] = []; const received: string[] = [];
  const graph = await CapabilityGraph.open(config({ providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
    const db = new FakeDatabase([record("a", { name, knowledge: [document("intro")] })]); db.knowledgeRootDir = root; return db;
  } } } }], knowledgeRetriever: wrap((input, _access, result) => { mappings.push(input.mappingRevision); received.push(input.staticRevisionByProvider.seed!); return result; }) }));
  try {
    const old = (await graph.getProvider("seed")).staticRevision;
    await graph.queryKnowledge({ text: "find", selected: [id()] });
    name = "second"; await graph.reload(); await graph.queryKnowledge({ text: "find", selected: [id()] });
    assert.equal(mappings[0], mappings[1]); assert.notEqual(received[0], received[1]);
    await graph.queryKnowledge({ text: "find", selected: [id()], requiredStaticRevision: old }); assert.equal(received[2], old);
    root = "C:/private/two"; await graph.reload(); await graph.queryKnowledge({ text: "find", selected: [id()] });
    assert.notEqual(mappings[3], mappings[1]);
  } finally { await graph.close(); }
});

test("E-18: removing a collection member changes mapping but preserves shared content and previous selection", async () => {
  let removed = false; const mappings: string[] = []; const contents: string[] = [];
  const graph = await CapabilityGraph.open(config({ providers: [{ providerId: "seed", authority: { kind: "database", adapter: {
    id: "fake", openView: async () => new FakeDatabase([
      record("a", { knowledge: [{ kind: "collection", knowledgeId: "manual", members: removed ? [document("intro")] : [document("intro"), document("routing")] }] }),
      record("b", { knowledge: [document("routing")] }),
    ]),
  } } }], knowledgeRetriever: wrap((input, _access, result) => {
    mappings.push(input.mappingRevision); contents.push(result.evidence.documents[0]!.sourceContentId); return result;
  }) }));
  try {
    const previous = (await graph.getProvider("seed")).staticRevision;
    assert.deepEqual((await graph.queryKnowledge({ text: "find", selected: [id()] })).items.map((item) => item.knowledgeId), ["intro", "routing"]);
    removed = true; assert.equal((await graph.reload()).ok, true);
    assert.deepEqual((await graph.queryKnowledge({ text: "find", selected: [id()] })).items.map((item) => item.knowledgeId), ["intro"]);
    assert.notEqual(mappings[0], mappings[1]); assert.equal(contents[0], contents[1]);
    assert.equal((await graph.queryKnowledge({ text: "find", selected: [id()], knowledgeIds: ["routing"] })).knowledgeState, "filtered_empty");
    assert.deepEqual((await graph.queryKnowledge({ text: "find", selected: [id("b")] })).items.map((item) => item.knowledgeId), ["routing"]);
    assert.deepEqual((await graph.queryKnowledge({ text: "find", selected: [id()], requiredStaticRevision: previous })).items.map((item) => item.knowledgeId), ["intro", "routing"]);
  } finally { await graph.close(); }
});

test("retriever failure remains isolated from catalog and direct reads", async () => {
  const graph = await CapabilityGraph.open(config({ knowledgeRetriever: { id: "broken", retrieve: async () => { throw new Error("private-path"); } } }));
  try {
    await assert.rejects(graph.queryKnowledge({ text: "find", selected: [id()] }), code("CG_RETRIEVER_UNAVAILABLE"));
    assert.equal((await graph.listCatalog()).items.length, 3);
    assert.ok((await graph.readDocuments({ selected: [id()], knowledgeIds: ["intro"] })).results[0]?.ok);
  } finally { await graph.close(); }
});

test("unawaited access reads keep the pinned source alive until completion, without granting later access", async () => {
  let unblock!: () => void; const gate = new Promise<void>((resolve) => { unblock = resolve; });
  let started!: () => void; const reading = new Promise<void>((resolve) => { started = resolve; });
  let saved: KnowledgeRetrievalAccess | undefined;
  const databases: FakeDatabase[] = [];
  const bytes = new TextEncoder().encode("background");
  const graph = await CapabilityGraph.open(config({
    providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => {
      const db = new FakeDatabase([record("a", { name: String(databases.length), knowledge: [document("intro")] })]); databases.push(db); return db;
    } } } }],
    readers: [{ id: "slow", canRead: () => true, read: async (_ref, _context, budget) => {
      assert.equal(budget.maxBytes, 32768); started(); await gate;
      return { bytes, contentId: contentId(bytes), contentType: "text/plain", source: "https://example.test/intro" };
    } }],
    knowledgeRetriever: { id: "background", retrieve: async (input, access) => {
      saved = access;
      void access.read({ id: id(), knowledgeId: "intro" }, { maxBytes: 100000 });
      return { hits: [], evidence: { staticRevisionByProvider: input.staticRevisionByProvider, mappingRevision: input.mappingRevision,
        freshness: "current", observedAt: new Date().toISOString(), sourceConfigRevision: "one", indexedConfigRevision: "one",
        documents: [{ id: id(), knowledgeId: "intro", sourceContentId: contentId(bytes), indexedContentId: contentId(bytes) }] } };
    } },
  }));
  let completed = false;
  const query = graph.queryKnowledge({ text: "find", selected: [id()] }).then((result) => { completed = true; return result; });
  try {
    await reading; await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    await graph.reload(); await graph.reload(); assert.equal(databases[0]!.closed, 0);
    await assert.rejects(saved!.read({ id: id(), knowledgeId: "intro" }, { maxBytes: 100 }), code("CG_ADAPTER_CONTRACT_INVALID"));
    unblock(); assert.equal((await query).knowledgeState, "searched"); assert.equal(databases[0]!.closed, 1);
  } finally { unblock(); await query.catch(() => {}); await graph.close(); }
});

test("same knowledge ID in two providers remains two independently attributed targets", async () => {
  const sources = ["other", "seed"];
  const graph = await CapabilityGraph.open(config({ hostAllowedProviders: sources, integrationEnabledProviders: sources,
    providers: sources.map((providerId) => ({ providerId, authority: { kind: "database", adapter: { id: providerId, openView: async () => {
      const db = new FakeDatabase([record("a", { knowledge: [document("intro")] })]); db.provider.providerId = providerId; return db;
    } } } })), knowledgeRetriever: fakeKnowledgeRetriever,
  }));
  try {
    const page = await graph.queryKnowledge({ text: "find", selected: [id(), id("a", "other")] });
    assert.deepEqual(page.items.map((hit) => hit.id.providerId), ["other", "seed"]);
    assert.equal(page.indexStatus?.validatedDocuments, 2);
  } finally { await graph.close(); }
});
