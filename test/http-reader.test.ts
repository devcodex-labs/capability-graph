import { CapabilityGraph, type KnowledgeReadContext, type KnowledgeDocumentRef } from "@devcodex/capability-graph";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import test from "node:test";
import { FileFixture, record } from './contract/file-fixture.js';
import { HttpKnowledgeReader } from "../examples/http-reader/knowledge-reader.js";
import { assertPortReleased } from "./contract/port-released.js";
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
  const db = new FileFixture([record('a', { knowledge: [document] })]);
  Object.assign(db.provider, { specification: { specificationId: 'spec', version: '1', documents: [{ ...document, knowledgeId: 'SPEC', role: 'specification' }] } });
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'], readers: [reader],
    providers: [{ providerId: 'seed', authority: db.authority }] });
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
  const db = new FileFixture([record('a', { knowledge: [ref(origin + '/guide')] })]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'], readers: [reader],
    providers: [{ providerId: 'seed', authority: db.authority }] });
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
    const db = new FileFixture([record('a', { knowledge: [ref(`${source.origin}/bad-utf8`)] })]);
    const graph = await CapabilityGraph.open({ hostAllowedProviders: ['seed'], integrationEnabledProviders: ['seed'],
      providers: [{ providerId: 'seed', authority: db.authority }], readers: [reader] });
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
