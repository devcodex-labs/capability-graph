import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import test from "node:test";
import { CapabilityGraph, type KnowledgeReadContext, type KnowledgeDocumentRef, type SourceChange } from "@devcodex/capability-graph";
import { FakeDatabase, record } from './contract/fake-database.js';
import { HttpKnowledgeReader } from "../examples/seed-runtime/knowledge-reader.js";
import { createHttpRetrievalExample, runHttpRetrievalDemo } from "../examples/seed-runtime/retrieval-demo.js";
import { TextKnowledgeRetriever } from "../examples/seed-runtime/text-retrieval.js";
import { assertPortReleased } from "./contract/http-service-process.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

const context: KnowledgeReadContext = { providerId: 'seed.http', staticRevision: 's:test',
  sourceContext: { providerId: 'seed.http', authorityKind: 'file', sourceRevision: 's:test' } };
const ref = (url: string): KnowledgeDocumentRef => ({ kind: 'document', knowledgeId: 'HTTP', role: 'guide', locator: { type: 'http', url } });
const contentId = (bytes: Uint8Array) => `k:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;

test('HTTP full-read budgets preserve actionable errors and leave oversized sources pageable', async () => {
  let body = Buffer.alloc(32768, 120);
  const source = await httpSource((_url, response) => { response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end(body); });
  const reader = new HttpKnowledgeReader({ allowedOrigins: [source.origin] });
  const document = ref(source.origin + '/guide');
  const db = new FakeDatabase([record('a', { knowledge: [document] })]);
  Object.assign(db.provider, { specification: { specificationId: 'spec', version: '1', documents: [{ ...document, knowledgeId: 'SPEC', role: 'specification' }] } });
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'], readers: [reader],
    providers: [{ providerId: 'seed', authority: { kind: 'database', adapter: { id: 'metadata', openView: async () => db } } }] });
  try {
    for (const size of [32768, 32769]) {
      body = Buffer.alloc(size, 120);
      for (const result of [await graph.forProvider('seed').readDocuments({ selected: ['a'] }), await graph.forProvider('seed').readSpecification()]) {
        const slot = result.results[0]!; assert.equal(slot.ok, size === 32768);
        if (slot.ok) assert.equal(slot.value.byteLength, size);
        else { assert.equal(slot.error.code, 'CG_BUDGET_EXCEEDED'); assert.equal(slot.error.nextAction, 'page_or_filter'); }
      }
      assert.equal(reader.activeRequests, 0);
    }
    let cursor: string | undefined; let text = '';
    do {
      const page = await graph.forProvider('seed').readDocumentPage({ capabilityId: 'a', knowledgeId: 'HTTP', ...(cursor ? { cursor } : {}) });
      assert.equal(page.totalBytes, body.length); text += page.text; cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(Buffer.from(text), body);
  } finally { await graph.close(); await reader.close(); await source.close(); }
});

test('strong ETag snapshot downloads a long source once, revalidates each page and rejects changed cursors', async () => {
  const directory = await createTestDirectory('http-snapshot-');
  let body = Buffer.from('source 中文🙂\n'.repeat(10000)); let version = '"1"'; let downloads = 0; let conditional = 0;
  const server = createServer((request, response) => {
    if (request.headers['if-none-match'] === version) { conditional++; response.writeHead(304, { etag: version }); response.end(); }
    else { if (request.method === 'GET') downloads++; response.writeHead(200, { etag: version, 'content-type': 'text/markdown' }); response.end(body); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [origin], snapshot: { directory, maxBytes: 1_000_000 } });
  let scans = 0; let scannedBytes = 0; const stream = reader.stream.bind(reader);
  reader.stream = async function* (...args) { scans++; for await (const chunk of stream(...args)) { scannedBytes += chunk.bytes.length; yield chunk; } };
  const db = new FakeDatabase([record('a', { knowledge: [ref(origin + '/guide')] })]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'], readers: [reader],
    providers: [{ providerId: 'seed', authority: { kind: 'database', adapter: { id: 'metadata', openView: async () => db } } }] });
  try {
    const query = { capabilityId: 'a', knowledgeId: 'HTTP' }; const bound = graph.forProvider('seed');
    let cursor: string | undefined; let text = ''; let firstCursor: string | undefined; let pages = 0;
    do { const page = await bound.readDocumentPage({ ...query, ...(cursor ? { cursor } : {}) }); text += page.text;
      firstCursor ??= page.nextCursor; cursor = page.nextCursor; pages++; } while (cursor);
    assert.deepEqual(Buffer.from(text), body); assert.equal(downloads, 1); assert.equal(conditional, pages - 1);
    assert.equal(scans, 1, 'continuations validate the strong source identity without scanning the snapshot again');
    assert.equal(scannedBytes, body.length);
    assert.equal(reader.cachedSnapshotBytes, body.length);
    body = Buffer.from('changed 中文🙂\n'.repeat(10000)); version = '"2"';
    await assert.rejects(bound.readDocumentPage({ ...query, cursor: firstCursor }), { code: 'CG_REVISION_MISMATCH' });
    assert.equal(downloads, 2);
  } finally {
    await graph.close(); await reader.close(); assert.deepEqual(await readdir(directory), []);
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); await removeTestDirectory(directory);
  }
});

test('conditional verification rejects outages and invalid validators, falls back when HEAD is unsupported, and cancels I/O', async () => {
  const directory = await createTestDirectory('http-proof-'); let mode = 'valid'; let gets = 0;
  const body = Buffer.from('stable source '.repeat(5000));
  const server = createServer((request, response) => {
    if (request.method === 'HEAD') {
      if (mode === 'slow') return;
      const status = mode === 'outage' ? 503 : mode === 'unsupported' ? 405 : mode === 'partial' ? 206 : 304;
      response.writeHead(status, { etag: mode === 'mismatch' ? '"other"' : '"fixed"' }); response.end();
    } else { gets++; response.writeHead(200, { etag: '"fixed"', 'content-type': 'text/plain' }); response.end(body); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [origin], timeoutMs: 100, snapshot: { directory } });
  const document = ref(origin + '/guide');
  try {
    const read = await reader.read(document, context, { maxBytes: body.length });
    assert.equal(await reader.isContentCurrent(document, context, read.contentId, {}), true);
    assert.equal(await reader.isContentCurrent(document, context, 'k:0000000000000000', {}), false);
    mode = 'unsupported'; assert.equal(await reader.isContentCurrent(document, context, read.contentId, {}), false);
    for (mode of ['outage', 'mismatch', 'partial', 'slow']) {
      await assert.rejects(reader.isContentCurrent(document, context, read.contentId, {})); assert.equal(reader.activeRequests, 0);
    }
    const controller = new AbortController();
    const pending = reader.isContentCurrent(document, context, read.contentId, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 20);
    try { await assert.rejects(pending); } finally { clearTimeout(timer); }
    assert.equal(reader.activeRequests, 0); assert.equal(gets, 1);
  } finally { await reader.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await removeTestDirectory(directory); }
});

test('weak validators and oversized snapshots remain fully readable; HTML and unsolicited partial bodies fail', async () => {
  const directory = await createTestDirectory('http-fallback-'); let calls = 0;
  const body = Buffer.from('exact large body '.repeat(1000));
  const source = await httpSource((url, response) => {
    calls++; response.writeHead(url === '/range' ? 206 : 200, { etag: url === '/weak' ? 'W/"1"' : '"1"', 'content-type': url === '/html' ? 'text/html' : 'text/plain' }); response.end(body);
  });
  const reader = new HttpKnowledgeReader({ allowedOrigins: [source.origin], snapshot: { directory, maxBytes: 100 } });
  try {
    for (const route of ['/weak', '/large']) for (let i = 0; i < 2; i++) {
      const value = await reader.read(ref(source.origin + route), context, { maxBytes: body.length }); assert.deepEqual(Buffer.from(value.bytes), body);
    }
    assert.equal(reader.cachedSnapshotBytes, 0); assert.equal(calls, 4);
    for (const route of ['/html', '/range']) await assert.rejects(reader.read(ref(source.origin + route), context, { maxBytes: body.length }));
  } finally { await reader.close(); assert.deepEqual(await readdir(directory), []); await source.close(); await removeTestDirectory(directory); }
});

test('cached snapshots are content-verified and recovery/capacity work while streams hold a lease', async () => {
  const directory = await createTestDirectory('snapshot-proof-'); const body = Buffer.from('original 中文 source\n');
  const server = createServer((request, response) => {
    if (request.headers['if-none-match'] === '"fixed"') { response.writeHead(304, { etag: '"fixed"' }); response.end(); }
    else { response.writeHead(200, { etag: '"fixed"', 'content-type': 'text/plain' }); response.end(body); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [origin], maxConcurrent: 1, snapshot: { directory, maxEntries: 1, maxBytes: 1024 } });
  try {
    const document = ref(origin + '/guide'); await reader.read(document, context, { maxBytes: 1024 });
    const folder = path.join(directory, (await readdir(directory))[0]!); const file = path.join(folder, (await readdir(folder))[0]!);
    await writeFile(file, Buffer.alloc(body.length, 120));
    await assert.rejects(reader.read(document, context, { maxBytes: 1024 }), /Snapshot changed/);
    assert.equal(reader.cachedSnapshotBytes, 0); assert.deepEqual(Buffer.from((await reader.read(document, context, { maxBytes: 1024 })).bytes), body);
    const iterator = reader.stream(document, context, { chunkBytes: 4 }); await iterator.next();
    await assert.rejects(reader.read(document, context, { maxBytes: 1024 }), /Source unavailable/);
    await iterator.return(); assert.equal(reader.activeRequests, 0);
    await reader.read(ref(origin + '/second'), context, { maxBytes: 1024 }); assert.equal((await readdir(folder)).length, 1);
  } finally {
    await reader.close(); assert.deepEqual(await readdir(directory), []);
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); await removeTestDirectory(directory);
  }
});

for (const finishOlderFirst of [true, false]) test(`HTTP invalidation blocks old cache publication; older query finishes first=${finishOlderFirst}`, async () => {
  const example = await createHttpRetrievalExample();
  const retriever = new TextKnowledgeRetriever();
  let captured!: () => void, captureFailed!: (error: unknown) => void, release!: () => void;
  const ready = new Promise<void>((resolve, reject) => { captured = resolve; captureFailed = reject; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0, graph: CapabilityGraph | undefined, pending: Promise<unknown> | undefined;
  try {
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed.http'], integrationEnabledProviders: ['seed.http'],
      providers: [{ providerId: 'seed.http', authority: { kind: 'file', definitionLayout: 'directory', rootDir: example.root } }],
      knowledgeRetriever: retriever, readers: [{ id: 'held-real-http', canRead: (ref) => example.reader.canRead(ref),
        read: async (...args) => {
          try {
            const body = await example.reader.read(...args);
            if (++reads === 1) { captured(); await resume; }
            return body;
          } catch (error) { captureFailed(error); throw error; }
        } }],
    });
    const provider = graph.forProvider('seed.http');
    const query = { selected: [{ capabilityId: 'route.validation' }], knowledgeIds: ['HTTP-GUIDE'], text: '请求校验' };
    const oldContentId = contentId(Buffer.from(example.body()));
    const older = provider.queryKnowledge(query);
    pending = older;
    older.catch(captureFailed);
    await ready;
    example.updateBody('请求校验新正文：先检查必填字段。\n');
    await retriever.invalidate({ providerId: 'seed.http', staticRevision: example.staticRevision, reason: 'knowledge_body' });
    assert.equal(retriever.cachedSelections, 0);
    if (finishOlderFirst) {
      release();
      const page = await older;
      assert(page.items.length > 0 && page.items.every((hit) => hit.contentId === oldContentId));
      assert.equal(retriever.cachedSelections, 0, 'invalidated request must not repopulate an empty cache');
    }
    const newer = await provider.queryKnowledge(query);
    assert(newer.items.length > 0 && newer.items.every((hit) => hit.contentId === contentId(Buffer.from(example.body()))));
    if (!finishOlderFirst) { release(); await older; }
    assert.equal(retriever.cachedSelections, 1);
    assert((await provider.queryKnowledge(query)).items.length > 0, 'old completion must not replace the new cache');
  } finally {
    release(); await Promise.allSettled(pending ? [pending] : []);
    await graph?.close(); await example.close();
    await assertPortReleased(example.sourcePort); await assertPortReleased(example.servicePort);
  }
});

async function httpSource(handler: (url: string, response: ServerResponse) => void) {
  const server = createServer((request, response) => handler(request.url!, response));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address !== 'string');
  return { origin: `http://127.0.0.1:${address.port}`, port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    }) };
}

test('HTTP Reader returns exact Chinese UTF-8 bytes/hash and rejects actual failed transfers', async () => {
  const body = Buffer.from('请求校验\n完整正文🙂');
  let calls = 0;
  const source = await httpSource((url, response) => {
    calls++;
    if (url === '/redirect') { response.writeHead(302, { location: '/ok' }); response.end(); }
    else if (url === '/missing') { response.writeHead(404); response.end(); }
    else if (url === '/encoded') { response.writeHead(200, { 'content-encoding': 'gzip' }); response.end(body); }
    else if (url === '/advertised') { response.writeHead(200, { 'content-length': '10000' }); response.end('x'); }
    else if (url === '/streamed') { response.writeHead(200); response.write('x'.repeat(32)); response.end('y'.repeat(32)); }
    else if (url === '/truncated') { response.writeHead(200, { 'content-length': '100' }); response.flushHeaders(); response.write('x'); response.destroy(); }
    else if (url === '/bad-utf8') { response.writeHead(200); response.end(Buffer.from([0xff])); }
    else { response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); response.write(body.subarray(0, 4)); response.end(body.subarray(4)); }
  });
  const reader = new HttpKnowledgeReader({ allowedOrigins: [source.origin] });
  try {
    const result = await reader.read(ref(`${source.origin}/ok`), context, { maxBytes: body.length });
    assert.deepEqual(Buffer.from(result.bytes), body); assert.equal(result.contentId, contentId(body));
    assert.equal(result.source, `${source.origin}/ok`); assert.equal(reader.activeRequests, 0);
    for (const route of ['/redirect', '/missing', '/encoded', '/advertised', '/streamed', '/truncated']) {
      await assert.rejects(reader.read(ref(`${source.origin}${route}`), context, { maxBytes: 32 }));
      assert.equal(reader.activeRequests, 0);
    }
    const before = calls;
    await assert.rejects(reader.read(ref('http://127.0.0.1:1/denied'), context, { maxBytes: 32 }));
    assert.equal(calls, before, 'denied origins must not reach the source');
    assert.equal(calls, 7, 'redirect must not be followed');
    const db = new FakeDatabase([record('a', { knowledge: [ref(`${source.origin}/bad-utf8`)] })]);
    const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'],
      providers: [{ providerId: 'seed', authority: { kind: 'database', adapter: { id: 'metadata-only', openView: async () => db } } }], readers: [reader] });
    try {
      const result = await graph.forProvider('seed').readDocuments({ selected: ['a'] });
      assert.equal(result.results[0]?.ok, false);
      if (result.results[0] && !result.results[0].ok) assert.equal(result.results[0].error.code, 'CG_SOURCE_UNREADABLE');
      assert.equal(result.meta.completeness, 'partial');
    } finally { await graph.close(); }
  } finally { await reader.close(); await source.close(); await assertPortReleased(source.port); }
});

test('HTTP deadlines, connection cap and host close actually terminate requests', async () => {
  let arrived!: () => void;
  const firstRequest = new Promise<void>((resolve) => { arrived = resolve; });
  const source = await httpSource((_url, response) => { response.writeHead(200); response.flushHeaders(); arrived(); });
  const reader = new HttpKnowledgeReader({ allowedOrigins: [source.origin], timeoutMs: 80, maxConcurrent: 1 });
  const closingReader = new HttpKnowledgeReader({ allowedOrigins: [source.origin], timeoutMs: 5000 });
  try {
    const timed = assert.rejects(reader.read(ref(`${source.origin}/hang`), context, { maxBytes: 32 }));
    await firstRequest;
    assert.equal(reader.activeRequests, 1);
    await assert.rejects(reader.read(ref(`${source.origin}/second`), context, { maxBytes: 32 }));
    await timed; assert.equal(reader.activeRequests, 0);
    const closing = assert.rejects(closingReader.read(ref(`${source.origin}/close`), context, { maxBytes: 32 }));
    assert.equal(closingReader.activeRequests, 1);
    await closingReader.close(); await closing;
    assert.equal(closingReader.activeRequests, 0);
    await assert.rejects(closingReader.read(ref(`${source.origin}/after-close`), context, { maxBytes: 32 }));
  } finally { await reader.close(); await closingReader.close(); await source.close(); await assertPortReleased(source.port); }
});

test('real HTTP task recalls, explicitly selects, reads, searches, rejects stale body and recovers', async () => {
  const result = await runHttpRetrievalDemo();
  assert(result.candidates.includes('route.validation'));
  assert.deepEqual(result.selected, ['route.validation', 'schema.request']);
  assert(result.knowledgeHits > 0 && result.recoveredHits > 0 && result.httpReads >= 4);
  assert.equal(result.zeroHits, 0); assert.equal(result.businessStatus, 201); assert.equal(result.modelCalls, 0);
});

test('lexical indexes keep UTF-8 offsets, evidence on zero hits and explicit config/revision invalidation', async () => {
  const example = await createHttpRetrievalExample();
  const provider = example.graph.forProvider('seed.http');
  const query = { selected: [{ capabilityId: 'route.validation' }], knowledgeIds: ['HTTP-GUIDE'], text: '请求校验' };
  const change = (reason: SourceChange['reason']): SourceChange => ({ providerId: 'seed.http', staticRevision: example.staticRevision, reason });
  try {
    example.knowledge.configure({ chunkBytes: 12 });
    const page = await provider.queryKnowledge(query);
    assert(page.items.length > 0); assert.equal(page.meta.completeness, 'complete');
    const bytes = Buffer.from(example.body());
    for (const hit of page.items) {
      assert.equal(bytes.subarray(hit.startOffset, hit.endOffset).toString('utf8'), hit.snippet);
      assert.equal(hit.contentId, contentId(bytes)); assert(hit.endOffset - hit.startOffset <= 12);
      assert.equal(hit.id.capabilityId, 'route.validation'); assert.equal(hit.knowledgeId, 'HTTP-GUIDE');
    }
    const reads = example.reads();
    const zero = await provider.queryKnowledge({ ...query, text: 'absentxyz' });
    assert.equal(zero.items.length, 0); assert.equal(zero.knowledgeState, 'searched');
    assert(example.reads() > reads, 'zero results still recheck source evidence');
    example.knowledge.configure({ chunkBytes: 16 });
    await assert.rejects(provider.queryKnowledge({ ...query, text: 'absentxyz' }), { code: 'CG_INDEX_STALE' });
    await example.knowledge.invalidate(change('configuration'));
    assert((await provider.queryKnowledge(query)).items.length > 0);
    const file = path.join(example.root, 'capabilities/route-validation.json');
    const definition = JSON.parse(await readFile(file, 'utf8')); definition.name = 'Updated validation';
    await writeFile(file, JSON.stringify(definition));
    await example.graph.reload({ providerId: 'seed.http' });
    await assert.rejects(provider.retrieveCapabilities({ text: 'validation' }), { code: 'CG_INDEX_STALE' });
    await assert.rejects(provider.queryKnowledge(query), { code: 'CG_REVISION_MISMATCH' });
    await example.capabilities.rebuild(example.graph); await example.knowledge.invalidate(change('metadata'));
    assert((await provider.retrieveCapabilities({ text: 'validation' })).items.length > 0);
    assert((await provider.queryKnowledge(query)).items.length > 0);
  } finally {
    await example.close(); assert.equal(example.reader.activeRequests, 0);
    await assertPortReleased(example.sourcePort); await assertPortReleased(example.servicePort);
    await assert.rejects(readFile(path.join(example.root, 'provider.json')), { code: 'ENOENT' });
  }
});

test('UTF-8 BOM and supplementary characters preserve exact HTTP snippet byte offsets', async () => {
  const example = await createHttpRetrievalExample();
  try {
    example.updateBody('\uFEFF请求🙂校验\n第二行请求验证\n');
    example.knowledge.configure({ chunkBytes: 12 });
    const page = await example.graph.forProvider('seed.http').queryKnowledge({
      selected: [{ capabilityId: 'route.validation' }], knowledgeIds: ['HTTP-GUIDE'], text: '请求校验',
    });
    assert.equal(page.meta.completeness, 'complete');
    assert.deepEqual(page.meta.warnings, []);
    assert(page.items.length > 0);
    const bytes = Buffer.from(example.body());
    for (const hit of page.items) {
      assert.equal(bytes.subarray(hit.startOffset, hit.endOffset).toString('utf8'), hit.snippet);
      assert.equal(hit.contentId, contentId(bytes));
      assert(hit.endOffset - hit.startOffset <= 12);
    }
    assert(page.items.some((hit) => hit.startOffset === 0 && hit.snippet.startsWith('\uFEFF')));
  } finally {
    await example.close();
    assert.equal(example.reader.activeRequests, 0);
    await assertPortReleased(example.sourcePort); await assertPortReleased(example.servicePort);
  }
});
