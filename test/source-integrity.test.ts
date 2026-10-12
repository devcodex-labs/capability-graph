import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { CapabilityGraph, CapabilityGraphError, type NeighborKind, type OpenConfig } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FileFixture, record } from "./contract/file-fixture.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

const config = (fixture: FileFixture, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], providers: [{ providerId: "seed",
    authority: fixture.authority }], ...extra,
});
const rejected = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const document = { kind: "document" as const, knowledgeId: "doc", role: "guide", locator: { type: "relative-file" as const, path: "doc.mdx" } };

test("full Document/Specification and pages retain exact BOM, CRLF and UTF-8 bytes with the same MIME", async () => {
  const root = await createTestDirectory("source-integrity-");
  try {
    for (const text of ["\uFEFF中文🙂\r\nnext\r\n", "", "正文🙂"]) {
      const original = Buffer.from(text); await writeFile(path.join(root, "doc.mdx"), original);
      const fixture = new FileFixture([record("a", { knowledge: [document] })]); fixture.knowledgeRootDir = root;
      Object.assign(fixture.provider, { specification: { specificationId: "spec", version: "1", documents: [{ ...document, knowledgeId: "spec", role: "specification" }] } });
      const graph = await CapabilityGraph.open(config(fixture));
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

test("custom Reader preserves only safe budget failures and strips backend diagnostics", async () => {
  const doc = { ...document, locator: { type: "http" as const, url: "https://example.invalid/guide" } };
  let budgetFailure = true;
  const graph = await CapabilityGraph.open(config(new FileFixture([record("a", { knowledge: [doc] })]), { readers: [{
    id: "controlled-failure", canRead: () => true, async read() {
      throw new CapabilityGraphError(budgetFailure ? "CG_BUDGET_EXCEEDED" : "CG_SOURCE_UNREADABLE", {
        nextAction: "repair_source", message: "/private/reader", details: { privatePath: "/private/reader" },
      });
    },
  }] }));
  try {
    for (budgetFailure of [true, false]) {
      const slot = (await graph.forProvider("seed").readDocuments({ selected: ["a"] })).results[0]!;
      assert.equal(slot.ok, false);
      if (!slot.ok) {
        assert.equal(slot.error.code, budgetFailure ? "CG_BUDGET_EXCEEDED" : "CG_READER_UNAVAILABLE");
        assert.equal(slot.error.nextAction, budgetFailure ? "page_or_filter" : "repair_source");
        assert.equal(slot.error.details, undefined); assert.doesNotMatch(slot.error.message, /private/);
      }
    }
  } finally { await graph.close(); }
});
