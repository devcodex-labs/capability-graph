import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { CapabilityGraph, CapabilityGraphError, type KnowledgeRetriever, type NeighborKind, type OpenConfig } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

const config = (db: FakeDatabase, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], providers: [{ providerId: "seed",
    authority: { kind: "database", adapter: { id: "controlled", openView: async () => db } } }], ...extra,
});
const rejected = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const document = { kind: "document" as const, knowledgeId: "doc", role: "guide", locator: { type: "relative-file" as const, path: "doc.mdx" } };

test("full Document/Specification and pages retain exact BOM, CRLF and UTF-8 bytes with the same MIME", async () => {
  const root = await createTestDirectory("source-integrity-");
  try {
    for (const text of ["\uFEFF中文🙂\r\nnext\r\n", "", "正文🙂"]) {
      const original = Buffer.from(text); await writeFile(path.join(root, "doc.mdx"), original);
      const db = new FakeDatabase([record("a", { knowledge: [document] })]); db.knowledgeRootDir = root;
      Object.assign(db.provider, { specification: { specificationId: "spec", version: "1", documents: [{ ...document, knowledgeId: "spec", role: "specification" }] } });
      const graph = await CapabilityGraph.open(config(db));
      try {
        const full = await graph.forProvider("seed").readDocuments({ selected: ["a"] });
        const spec = await graph.readSpecification({ providerId: "seed" });
        for (const slot of [...full.results, ...spec.results]) {
          assert.ok(slot.ok); assert.deepEqual(Buffer.from(slot.value.text), original);
          assert.equal(slot.value.byteLength, original.length); assert.equal(slot.value.contentId, contentId(original));
          assert.equal(slot.value.contentType, "text/markdown; charset=utf-8");
        }
        const page = await graph.forProvider("seed").readDocumentPage({ capabilityId: "a", knowledgeId: "doc" });
        const specPage = await graph.readSpecificationPage({ providerId: "seed", knowledgeId: "spec" });
        for (const item of [page, specPage]) { assert.deepEqual(Buffer.from(item.text), original); assert.equal(item.contentId, contentId(original)); }
      } finally { await graph.close(); }
    }
  } finally { await removeTestDirectory(root); }
});

test("external index claims are source-verified even when it never uses retrieval access", async () => {
  const root = await createTestDirectory("source-proof-");
  try {
    const original = Buffer.from("Actual 中文 source"); await writeFile(path.join(root, "doc.mdx"), original);
    for (const mode of ["invented", "forged", "zero-forged", "zero-correct", "correct"] as const) {
      const db = new FakeDatabase([record("a", { knowledge: [document] })]); db.knowledgeRootDir = root;
      const retriever: KnowledgeRetriever = { id: "external-index", async retrieve(input) {
        const target = input.targets[0]!; const hash = mode.includes("forged") ? "k:0000000000000000" : contentId(original);
        const snippet = mode === "invented" ? "INVENTED" : original.toString();
        return { hits: mode.startsWith("zero") ? [] : [{ id: target.id, knowledgeId: target.knowledgeId, contentId: hash,
          source: "doc.mdx", startOffset: 0, endOffset: Buffer.byteLength(snippet), snippet }], evidence: {
          staticRevisionByProvider: input.staticRevisionByProvider, mappingRevision: input.mappingRevision,
          freshness: "current", observedAt: new Date().toISOString(), sourceConfigRevision: "1", indexedConfigRevision: "1",
          documents: [{ id: target.id, knowledgeId: target.knowledgeId, sourceContentId: hash, indexedContentId: hash }],
        } };
      } };
      const graph = await CapabilityGraph.open(config(db, { knowledgeRetriever: retriever }));
      try {
        const query = () => graph.queryKnowledge({ selected: [{ providerId: "seed", capabilityId: "a" }], text: "Actual" });
        if (mode.includes("forged")) await assert.rejects(query(), rejected("CG_INDEX_STALE"));
        else {
          const page = await query(); assert.equal(page.items.length, mode === "correct" ? 1 : 0);
          assert.equal(page.meta.completeness, mode === "invented" ? "partial" : "complete");
          assert.equal(page.indexStatus?.validatedDocuments, 1);
        }
      } finally { await graph.close(); }
    }
  } finally { await removeTestDirectory(root); }
});

test("catalog rejects missing head, middle, tail and fake empty termination after publication", async () => {
  for (const omitted of ["a", "b", "c", "all"]) {
    const db = new FakeDatabase([record("a"), record("b"), record("c")]);
    const graph = await CapabilityGraph.open(config(db));
    try {
      db.scanCapabilities = async (request) => db.page(db.records.filter((r) => omitted !== "all" && r.capabilityId !== omitted), request);
      await assert.rejects(graph.listCatalog(), rejected("CG_ADAPTER_CONTRACT_INVALID"));
    } finally { await graph.close(); }
  }
});

test("publication rejects omissions in all eight relation streams", async () => {
  for (const kind of ["parents", "children", "specializes", "specializedBy", "requires", "requiredBy", "related", "relatedBy"] as NeighborKind[]) {
    const db = new FakeDatabase([record("a", { parents: ["b"], specializes: ["b"], requires: ["b"], related: ["b"] }), record("b")]);
    const neighbors = db.neighbors.bind(db); db.neighbors = async (id, relation, page) => relation === kind ? { items: [] } : neighbors(id, relation, page);
    await assert.rejects(CapabilityGraph.open(config(db)), rejected("CG_ADAPTER_CONTRACT_INVALID")); assert.equal(db.closed, 1);
  }
});

test("public Runtime preserves actionable errors while stripping private adapter details", async () => {
  for (const code of ["CG_REVISION_MISMATCH", "CG_RUNTIME_RESULT_MISMATCH", "CG_RUNTIME_CONTEXT_REQUIRED"] as const) {
    const graph = await CapabilityGraph.open(config(new FakeDatabase([record("a")]), { runtimeAdapters: [{ id: "typed", providerId: "seed", query: async () => {
      throw new CapabilityGraphError(code, { nextAction: "repair_source", message: "/private/source", details: { secret: "private" } });
    } }] }));
    try { await assert.rejects(graph.forProvider("seed").queryRuntime({ project: "app", environment: "test" }), (error: unknown) => {
      assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, code); assert.equal(error.details, undefined);
      assert.equal(error.nextAction, code === "CG_REVISION_MISMATCH" ? "refresh" : "fix_input"); assert.equal(error.message.includes("private"), false); return true;
    }); } finally { await graph.close(); }
  }
});
