import assert from "node:assert/strict";
import { readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, type KnowledgeReader } from "../src/index.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";
import { HttpKnowledgeReader } from "../examples/seed-runtime/knowledge-reader.js";

const source = "https://range.invalid/document";
const open = (reader: KnowledgeReader) => CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], readers: [reader],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "range-source", openView: async () => new FakeDatabase([record("a", {
    knowledge: [{ kind: "document", knowledgeId: "DOC", role: "guide", locator: { type: "http", url: source } }],
  })]) } } }] });
const query = { capabilityId: "a", knowledgeId: "DOC" };

test("large-source ranges are independently verified; invalid metadata or forged bytes cannot reuse a source hash", async () => {
  const bytes = Buffer.alloc(5_242_880, 120); Buffer.from("\ufeff中文🙂\r\n").copy(bytes);
  let mode = "valid"; let scans = 0; let ranges = 0;
  const reader: KnowledgeReader = { id: "range-proof", canRead: () => true, read: async () => { throw new Error("Use stream"); },
    async *stream(_ref, _context, options) { scans++; for (let offset = 0; offset < bytes.length; offset += options.chunkBytes)
      yield { bytes: bytes.subarray(offset, offset + options.chunkBytes), contentType: "text/plain", source }; },
    isContentCurrent: async () => true,
    async readRange(_ref, _context, options) {
      ranges++; if (mode === "missing") return undefined;
      const data = Buffer.from(bytes.subarray(options.startOffset, options.endOffset));
      if (mode === "forged") data[0] = data[0]! ^ 1;
      return { bytes: mode === "length" ? data.subarray(1) : data,
        contentId: mode === "identity" ? "k:other" : options.contentId, source: mode === "source" ? source + "/other" : source,
        contentType: mode === "mime" ? "text/markdown" : "text/plain", totalBytes: bytes.length + (mode === "size" ? 1 : 0) };
    } };
  const graph = await open(reader); const bound = graph.forProvider("seed");
  try {
    const first = await bound.readDocumentPage({ ...query, maxBytes: 4099 }); assert(first.nextCursor);
    await assert.rejects(bound.readDocumentPage({ ...query, startOffset: 1 }), { code: "CG_INPUT_INVALID" });
    const next = await bound.readDocumentPage({ ...query, cursor: first.nextCursor });
    assert.equal(next.text, bytes.subarray(next.startOffset, next.endOffset).toString()); assert.equal(scans, 1);
    for (mode of ["forged", "length", "identity", "source", "mime", "size"]) {
      await assert.rejects(bound.readDocumentPage({ ...query, cursor: first.nextCursor }), { code: "CG_ADAPTER_CONTRACT_INVALID" });
      mode = "valid"; await bound.readDocumentPage(query);
    }
    mode = "missing"; const before = scans;
    assert.equal((await bound.readDocumentPage({ ...query, cursor: first.nextCursor })).contentId, first.contentId);
    assert.equal(scans, before + 1, "an unavailable range falls back to a complete verified scan");
    mode = "valid";
    const controller = new AbortController(); controller.abort(); const beforeRange = ranges;
    await assert.rejects(bound.readDocumentPage({ ...query, cursor: first.nextCursor, signal: controller.signal }), { code: "CG_READER_UNAVAILABLE" });
    assert.equal(ranges, beforeRange);
  } finally { await graph.close(); }
});

test("five MiB HTTP pagination scans once and retains bounded disk bytes; drift, missing files and tampering remain explicit", async () => {
  const directory = await createTestDirectory("http-large-range-");
  let bytes = Buffer.alloc(5_242_880, 120); let etag = '"version-1"'; let downloads = 0; let validations = 0;
  const server = createServer((req, res) => {
    if (req.headers["if-none-match"] === etag) { validations++; res.writeHead(304, { etag }).end(); }
    else { if (req.method === "GET") downloads++; res.writeHead(200, { etag, "content-type": "text/plain" }).end(bytes); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); const origin = `http://127.0.0.1:${address.port}`;
  const transport = new HttpKnowledgeReader({ allowedOrigins: [origin], snapshot: { directory, maxBytes: 6_291_456, maxEntries: 1 } });
  let scans = 0; let scannedBytes = 0; let rangeBytes = 0;
  const reader: KnowledgeReader = { id: "large-http", canRead: () => true, read: (...args) => transport.read(...args),
    async *stream(...args) { scans++; for await (const chunk of transport.stream(...args)) { scannedBytes += chunk.bytes.length; yield chunk; } },
    isContentCurrent: (...args) => transport.isContentCurrent(...args),
    readRange: async (...args) => { const range = await transport.readRange!(...args); rangeBytes += range?.bytes.length ?? 0; return range; } };
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], readers: [reader],
    providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "http", openView: async () => new FakeDatabase([record("a", {
      knowledge: [{ kind: "document", knowledgeId: "DOC", role: "guide", locator: { type: "http", url: origin + "/guide" } }],
    })]) } } }] });
  const bound = graph.forProvider("seed");
  try {
    const expectedContentId = contentId(bytes);
    let cursor: string | undefined; let firstCursor: string | undefined; let pages = 0; let offset = 0;
    do {
      const page = await bound.readDocumentPage({ ...query, ...(cursor ? { cursor } : {}) });
      assert.equal(page.startOffset, offset); assert.equal(page.text, bytes.subarray(page.startOffset, page.endOffset).toString());
      assert.equal(page.contentId, expectedContentId); assert.equal(page.pageContentId, contentId(Buffer.from(page.text)));
      firstCursor ??= page.nextCursor; cursor = page.nextCursor; offset = page.endOffset; pages++;
    } while (cursor);
    assert.equal(pages, 160); assert.equal(offset, bytes.length); assert.equal(scans, 1); assert.equal(scannedBytes, bytes.length);
    assert.equal(downloads, 1); assert.equal(validations, 159); assert(rangeBytes < bytes.length * 2);
    assert.equal(transport.cachedSnapshotBytes, bytes.length);
    await Promise.all(Array.from({ length: 3 }, () => bound.readDocumentPage({ ...query, cursor: firstCursor })));
    assert.equal(scans, 1); assert.equal(transport.activeRequests, 0);
    const folder = path.join(directory, (await readdir(directory))[0]!);
    const file = path.join(folder, (await readdir(folder))[0]!);
    await writeFile(file, Buffer.alloc(bytes.length, 121));
    await assert.rejects(bound.readDocumentPage({ ...query, cursor: firstCursor }), { code: "CG_READER_UNAVAILABLE" });
    await bound.readDocumentPage(query); assert.equal(downloads, 2);
    await rm(path.join(folder, (await readdir(folder))[0]!));
    await bound.readDocumentPage({ ...query, cursor: firstCursor }); assert.equal(downloads, 3);
    bytes = Buffer.alloc(bytes.length, 122); etag = '"version-2"';
    await assert.rejects(bound.readDocumentPage({ ...query, cursor: firstCursor }), { code: "CG_REVISION_MISMATCH" });
    assert.equal(downloads, 4);
  } finally {
    await graph.close(); await transport.close(); assert.deepEqual(await readdir(directory), []);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await removeTestDirectory(directory);
  }
});

test("large range metadata stays graph-scoped; absent strong proof preserves complete scanning", async () => {
  const bytes = Buffer.alloc(4_194_305, 120); let scans = 0; let ranges = 0;
  const reader: KnowledgeReader = { id: "range-scope", canRead: () => true, read: async () => { throw new Error("Use stream"); },
    async *stream(_ref, _context, options) { scans++; for (let offset = 0; offset < bytes.length; offset += options.chunkBytes)
      yield { bytes: bytes.subarray(offset, offset + options.chunkBytes), contentType: "text/plain", source }; },
    isContentCurrent: async () => true,
    readRange: async (_ref, _context, options) => { ranges++; return { bytes: bytes.subarray(options.startOffset, options.endOffset),
      contentId: options.contentId, totalBytes: bytes.length, source, contentType: "text/plain" }; } };
  const first = await open(reader); const second = await open(reader);
  try {
    const page = await first.forProvider("seed").readDocumentPage(query);
    await first.forProvider("seed").readDocumentPage({ ...query, cursor: page.nextCursor }); assert.equal(scans, 1);
    await second.forProvider("seed").readDocumentPage(query); assert.equal(scans, 2);
  } finally { await first.close(); await second.close(); }
  const { isContentCurrent: _proof, ...unproved } = reader;
  const third = await open(unproved); const before = ranges;
  try {
    const page = await third.forProvider("seed").readDocumentPage(query);
    await third.forProvider("seed").readDocumentPage({ ...query, cursor: page.nextCursor });
    assert.equal(scans, 4); assert.equal(ranges, before);
  } finally { await third.close(); }
  await assert.rejects(open({ ...reader, readRange: 1 as unknown as KnowledgeReader["readRange"] }), { code: "CG_CONFIG_INCOMPLETE" });
});

test("large source proof entries obey LRU capacity and re-scan an evicted source", async () => {
  const bytes = Buffer.alloc(4_194_305, 120); let scans = 0;
  const capabilityId = (index: number) => `c${String(index).padStart(2, "0")}`;
  let pauseRange = false; let release!: () => void; let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  const reader: KnowledgeReader = { id: "range-lru", canRead: () => true, read: async () => { throw new Error("Use stream"); },
    async *stream(ref, _context, options) { scans++; for (let offset = 0; offset < bytes.length; offset += options.chunkBytes)
      yield { bytes: bytes.subarray(offset, offset + options.chunkBytes), contentType: "text/plain", source: ref.locator.type === "http" ? ref.locator.url : "" }; },
    isContentCurrent: async () => true,
    readRange: async (ref, _context, options) => {
      if (pauseRange) { started(); await resume; }
      return { bytes: bytes.subarray(options.startOffset, options.endOffset), contentId: options.contentId,
        totalBytes: bytes.length, contentType: "text/plain", source: ref.locator.type === "http" ? ref.locator.url : "" };
    } };
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], readers: [reader],
    providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "lru", openView: async () => new FakeDatabase(Array.from({ length: 17 }, (_, i) =>
      record(capabilityId(i), { knowledge: [{ kind: "document", knowledgeId: `D${i}`, role: "guide", locator: { type: "http", url: `${source}/${i}` } }] }))) } } }] });
  try {
    const bound = graph.forProvider("seed");
    for (let i = 0; i < 17; i++) await bound.readDocumentPage({ capabilityId: capabilityId(i), knowledgeId: `D${i}` });
    assert.equal(scans, 17);
    await bound.readDocumentPage({ capabilityId: "c16", knowledgeId: "D16", startOffset: 32768 }); assert.equal(scans, 17);
    await bound.readDocumentPage({ capabilityId: "c00", knowledgeId: "D0", startOffset: 32768 }); assert.equal(scans, 18);
    pauseRange = true;
    const pending = bound.readDocumentPage({ capabilityId: "c16", knowledgeId: "D16", startOffset: 32768 });
    await waiting;
    try {
      // Fill the slot released by a borrowed proof while that page is still waiting on I/O.
      await bound.readDocumentPage({ capabilityId: "c01", knowledgeId: "D1" }); assert.equal(scans, 19);
    } finally { pauseRange = false; release(); await pending; }
    await bound.readDocumentPage({ capabilityId: "c02", knowledgeId: "D2" });
    assert.equal(scans, 20, "re-inserting a borrowed proof must evict the oldest entry at capacity");
  } finally { release(); await graph.close(); }
});
