import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createServer } from "node:http";
import { CapabilityGraph } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";
import { HttpKnowledgeReader } from "../examples/seed-runtime/knowledge-reader.js";
import { TextKnowledgeRetriever } from "../examples/seed-runtime/text-retrieval.js";

async function fixture(run: (graph: CapabilityGraph, root: string, text: string) => Promise<void>) {
  const root = await createTestDirectory("capability-graph-pages-");
  const text = '\ufeff# 长文档\n\n' + ('中文🙂 paragraph\n\n```ts\n' + 'const value = "🙂";'.repeat(180) + '\n```\n\n').repeat(30);
  let graph: CapabilityGraph | undefined;
  try {
    await writeFile(path.join(root, "doc.md"), text);
    await writeFile(path.join(root, "provider.json"), JSON.stringify({ providerId: "pages", name: "Pages", version: "1",
      specification: { specificationId: "spec", version: "1", documents: [{ kind: "document", knowledgeId: "SPEC", role: "specification", locator: { type: "relative-file", path: "doc.md" } }] } }));
    for (const capabilityId of ["a", "b"]) await writeFile(path.join(root, `${capabilityId}.capability.json`), JSON.stringify({ capabilityId, name: capabilityId, description: "pages", whenToUse: "Read pages",
      knowledge: [{ kind: "document", knowledgeId: "DOC", role: "guide", locator: { type: "relative-file", path: "doc.md" } }] }));
    graph = await CapabilityGraph.open({ hostAllowedProviders: ["pages"], integrationEnabledProviders: ["pages"],
      providers: [{ providerId: "pages", authority: { kind: "file", rootDir: root } }], knowledgeRetriever: new TextKnowledgeRetriever() });
    await run(graph, root, text);
  } finally { await graph?.close(); await removeTestDirectory(root); }
}

test("UTF-8 pages reconstruct large documents and overlong fences exactly, with distinct page hashes", async () => fixture(async (graph, _root, text) => {
  const bound = graph.forProvider("pages"); let cursor: string | undefined; let restored = ""; let offset = 0;
  do {
    const page = await bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", maxBytes: 4099, ...(cursor ? { cursor } : {}) });
    assert.equal(page.startOffset, offset); assert.equal(page.contentId, contentId(Buffer.from(text)));
    assert.equal(page.totalBytes, Buffer.byteLength(text)); assert.equal(page.pageContentId, contentId(Buffer.from(page.text)));
    assert.equal(page.byteLength, page.endOffset - page.startOffset); assert.ok(page.byteLength <= 4099);
    assert.equal(page.complete, false); assert.equal(page.hasMore, Boolean(page.nextCursor));
    restored += page.text; offset = page.endOffset; cursor = page.nextCursor;
  } while (cursor);
  assert.equal(restored, text);
  const spec = await bound.readSpecificationPage({ knowledgeId: "SPEC", maxBytes: 500 });
  assert.equal(spec.contentId, contentId(Buffer.from(text))); assert.ok(spec.nextCursor);
  const full = await graph.readDocuments({ selected: [{ providerId: "pages", capabilityId: "a" }] });
  assert.ok(full.results[0]?.ok); assert.equal(full.results[0].value.byteLength, Buffer.byteLength(text));
  const found = await bound.queryKnowledge({ text: "paragraph", selected: [{ capabilityId: "a" }], limit: 2 });
  assert.equal(found.items.length, 2); assert.equal(found.meta.completeness, "complete");
  for (const hit of found.items) assert.equal(Buffer.from(text).subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
}));

test("cursors reject body changes, identity changes and metadata drift; invalid UTF-8 offsets fail", async () => fixture(async (graph, root, text) => {
  const bound = graph.forProvider("pages"); const first = await bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", maxBytes: 4099 });
  await assert.rejects(bound.readDocumentPage({ capabilityId: "b", knowledgeId: "DOC", cursor: first.nextCursor! }), { code: "CG_REVISION_MISMATCH" });
  await assert.rejects(bound.readSpecificationPage({ knowledgeId: "SPEC", cursor: first.nextCursor! }), { code: "CG_REVISION_MISMATCH" });
  await assert.rejects(bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", startOffset: 1 }), { code: "CG_INPUT_INVALID" });
  await writeFile(path.join(root, "doc.md"), text + "changed");
  await assert.rejects(bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", cursor: first.nextCursor! }), { code: "CG_REVISION_MISMATCH" });
  assert.throws(() => bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", maxBytes: 32769 }), { code: "CG_BUDGET_EXCEEDED" });
}));

test("documents larger than the entire response budget remain readable through bounded ranges", async () => fixture(async (graph, root) => {
  const line = "paragraph🙂\n";
  const text = line.repeat(310000);
  const body = Buffer.from(text); assert.ok(body.length > 4_194_304);
  await writeFile(path.join(root, "doc.md"), body);
  const bound = graph.forProvider("pages");
  const first = await bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC" });
  assert.equal(first.totalBytes, body.length); assert.equal(first.contentId, contentId(body)); assert.ok(first.nextCursor);
  const startOffset = body.length - Buffer.byteLength(line) * 20;
  const last = await bound.readDocumentPage({ capabilityId: "a", knowledgeId: "DOC", startOffset, maxBytes: 512 });
  assert.equal(last.text, body.subarray(startOffset).toString()); assert.equal(last.hasMore, false); assert.equal(last.complete, false);
  const full = await bound.readDocuments({ selected: ["a"] });
  assert.equal(full.results[0]!.ok, false);
  if (!full.results[0]!.ok) assert.equal(full.results[0]!.error.code, "CG_BUDGET_EXCEEDED");
}));

test("HTTP pages work without Range and abort closes real I/O before returning", async () => {
  const root = await createTestDirectory("capability-graph-http-pages-");
  let sockets = 0; let requests = 0; const text = "中文🙂\n".repeat(16000);
  const server = createServer((req, res) => {
    requests++;
    res.setHeader("content-type", "text/plain");
    if (req.url === "/slow") { res.write("start\n"); return; }
    res.end(text);
  });
  server.on("connection", (socket) => { sockets++; socket.on("close", () => sockets--); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port; const origin = `http://127.0.0.1:${port}`;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [origin], timeoutMs: 1000 });
  const originalStream = reader.stream.bind(reader);
  reader.stream = (...args) => { assert.ok(args[2].chunkBytes <= 1028, "verification respects the configured chunk budget, with UTF-8 lookahead for pages"); return originalStream(...args); };
  let graph: CapabilityGraph | undefined;
  try {
    await writeFile(path.join(root, "provider.json"), JSON.stringify({ providerId: "http", name: "HTTP", version: "1" }));
    await writeFile(path.join(root, "a.capability.json"), JSON.stringify({ capabilityId: "a", name: "a", description: "HTTP", whenToUse: "read",
      knowledge: ["doc", "slow"].map((knowledgeId) => ({ kind: "document", knowledgeId, role: "guide", locator: { type: "http", url: `${origin}/${knowledgeId}` } })) }));
    graph = await CapabilityGraph.open({ hostAllowedProviders: ["http"], integrationEnabledProviders: ["http"], providers: [{ providerId: "http", authority: { kind: "file", rootDir: root } }], readers: [reader], knowledgeRetriever: new TextKnowledgeRetriever(), budgets: { read: { maxBytes: 1024 } } });
    const bound = graph.forProvider("http"); const first = await bound.readDocumentPage({ capabilityId: "a", knowledgeId: "doc", maxBytes: 1024 });
    assert.equal(first.totalBytes, Buffer.byteLength(text)); assert.equal(first.contentId, contentId(Buffer.from(text)));
    const before = requests;
    const hits = await bound.queryKnowledge({ selected: [{ capabilityId: "a" }], knowledgeIds: ["doc"], text: "中文", limit: 3 });
    assert.equal(hits.items.length, 3); assert.equal(hits.meta.completeness, "complete");
    assert.equal(requests - before, 2, "one index scan and one shared verification scan for three snippets");
    for (const hit of hits.items) assert.equal(Buffer.from(text).subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
    const controller = new AbortController(); const pending = bound.readDocumentPage({ capabilityId: "a", knowledgeId: "slow", signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 30);
    try { await assert.rejects(pending, { code: "CG_READER_UNAVAILABLE" }); } finally { clearTimeout(timer); }
    assert.equal(reader.activeRequests, 0);
  } finally { await graph?.close(); await reader.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await removeTestDirectory(root); }
  assert.equal(sockets, 0);
});
