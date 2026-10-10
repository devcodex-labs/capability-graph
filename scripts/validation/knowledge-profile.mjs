import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { HttpKnowledgeReader } from '../../dist-test/examples/seed-runtime/knowledge-reader.js';
import { TextKnowledgeRetriever } from '../../dist-test/examples/seed-runtime/text-retrieval.js';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';

// Fresh, single-selection scenarios make cache state observable without inferring it from query count.
const root = await createTemporaryDirectory('capability-graph-knowledge-profile-');
const workloads = [
  { name: 'cacheable', repetitions: 256 },
  { name: 'dense-default', repetitions: 4000 },
  { name: 'capacity-overflow', repetitions: 256, maxCachedEntries: 1 },
].map((workload) => ({ ...workload,
  bodies: Array.from({ length: 8 }, (_, i) => Buffer.from((`# Document ${i}\n\nneedle${i} 中文🙂 exact bytes\n\n`).repeat(workload.repetitions))),
}));
const sources = new Map(workloads.flatMap(({ name, bodies }) => bodies.map((body, i) => [`/${name}/${i}`, body])));
const pageBody = Buffer.alloc(1_048_576, 120);
let requests = 0; let servedBytes = 0;
const sockets = new Set();
const server = createServer((req, res) => {
  if (req.url === '/paged') {
    requests++; res.setHeader('etag', '"fixed-page-source"'); res.setHeader('content-type', 'text/plain');
    if (req.headers['if-none-match'] === '"fixed-page-source"') { res.writeHead(304).end(); return; }
    if (req.method === 'GET') servedBytes += pageBody.length;
    res.end(pageBody); return;
  }
  const body = sources.get(req.url);
  if (!body) { res.writeHead(404).end(); return; }
  requests++; servedBytes += body.length;
  res.setHeader('content-type', 'text/markdown; charset=utf-8'); res.end(body);
});
server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
let listening = false;
const cacheState = (retriever) => ({ cachedSelections: retriever.cachedSelections,
  cachedEntries: retriever.cachedEntries, cachedBytes: retriever.cachedBytes });
const latency = (samples) => {
  const values = samples.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  return { samples: values.length, p50Ms: values.length ? values[Math.ceil(values.length * .5) - 1] : null,
    p95Ms: values.length ? values[Math.ceil(values.length * .95) - 1] : null };
};
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); listening = true;
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  for (const workload of workloads) {
    const directory = path.join(root, workload.name); await mkdir(directory);
    await writeFile(path.join(directory, 'provider.json'), JSON.stringify({ providerId: 'profile', name: 'Profile', version: '1' }));
    for (let i = 0; i < workload.bodies.length; i++) await writeFile(path.join(directory, `${i}.capability.json`), JSON.stringify({
      capabilityId: `c${i}`, name: `Document ${i}`, description: 'Transport profile', whenToUse: 'Measure byte-exact knowledge I/O',
      knowledge: [{ kind: 'document', knowledgeId: `DOC${i}`, role: 'guide', locator: { type: 'http', url: `${origin}/${workload.name}/${i}` } }],
    }));
    for (const mode of ['read-only', 'streaming']) for (const count of [1, 8]) {
      const transport = new HttpKnowledgeReader({ allowedOrigins: [origin], timeoutMs: 5000 });
      const retriever = new TextKnowledgeRetriever();
      const cacheBudgets = { maxCachedBytes: 8_388_608, maxCachedEntries: workload.maxCachedEntries ?? 10_000 };
      retriever.configure(cacheBudgets);
      const metrics = { readCalls: 0, streamCalls: 0, receivedBytes: 0 };
      const reader = {
        id: `profile-${mode}`, canRead: (ref) => transport.canRead(ref),
        read: async (...args) => { metrics.readCalls++; const body = await transport.read(...args); metrics.receivedBytes += body.bytes.length; return body; },
        ...(mode === 'streaming' ? { stream: async function* (...args) {
          metrics.streamCalls++; for await (const part of transport.stream(...args)) { metrics.receivedBytes += part.bytes.length; yield part; }
        } } : {}),
      };
      let graph;
      try {
        graph = await CapabilityGraph.open({ hostAllowedProviders: ['profile'], integrationEnabledProviders: ['profile'],
          providers: [{ providerId: 'profile', authority: { kind: 'file', rootDir: directory } }], readers: [reader], knowledgeRetriever: retriever });
        const selected = workload.bodies.slice(0, count).map((_, i) => ({ providerId: 'profile', capabilityId: `c${i}` }));
        // One unchanged selection per fresh retriever: its only retained index is exactly this selection.
        const shouldRetain = workload.name === 'cacheable' || (workload.name === 'dense-default' && count === 1);
        const samples = [];
        for (let iteration = 0; iteration < 8; iteration++) {
          const before = { ...metrics, requests, servedBytes }; const cacheBefore = cacheState(retriever);
          const indexCache = cacheBefore.cachedSelections ? 'hit' : 'miss'; const start = performance.now();
          const text = iteration === 7 ? 'definitelymissingtoken' : 'needle0';
          const page = await graph.queryKnowledge({ selected, text, limit: 3 });
          const elapsedMs = performance.now() - start;
          assert.equal(page.meta.completeness, 'complete');
          assert.equal(page.items.length, iteration === 7 ? 0 : 3);
          for (const hit of page.items) {
            const body = workload.bodies[Number(hit.id.capabilityId.slice(1))];
            assert.equal(body.subarray(hit.startOffset, hit.endOffset).toString('utf8'), hit.snippet);
          }
          const cacheAfter = cacheState(retriever);
          assert.equal(cacheBefore.cachedSelections, iteration === 0 || !shouldRetain ? 0 : 1);
          assert.equal(cacheAfter.cachedSelections, shouldRetain ? 1 : 0);
          assert(cacheAfter.cachedEntries <= cacheBudgets.maxCachedEntries && cacheAfter.cachedBytes <= cacheBudgets.maxCachedBytes);
          if (!shouldRetain) assert.deepEqual(cacheAfter, { cachedSelections: 0, cachedEntries: 0, cachedBytes: 0 });
          samples.push({ phase: iteration === 0 ? 'cold' : iteration === 7 ? 'zero-hit' : `cache-${indexCache}`, indexCache,
            cacheBefore, cacheAfter, elapsedMs,
            readCalls: metrics.readCalls - before.readCalls, streamCalls: metrics.streamCalls - before.streamCalls,
            receivedBytes: metrics.receivedBytes - before.receivedBytes, httpRequests: requests - before.requests,
            servedBytes: servedBytes - before.servedBytes, responseBytes: Buffer.byteLength(JSON.stringify(page)) });
          assert.equal(transport.activeRequests, 0);
          const verification = page.items.length && workload.bodies[0].length > 32768 ? 1 : 0;
          assert.equal(requests - before.requests, count + verification, 'fresh sources plus one shared verification of a hit document beyond the query snapshot');
        }
        results.push({ workload: workload.name, mode, documents: count, documentBytes: workload.bodies[0].length, cacheBudgets, samples,
          phases: Object.fromEntries(['cold', 'cache-hit', 'cache-miss', 'zero-hit'].map((phase) => [phase, latency(samples.filter((sample) => sample.phase === phase))])) });
      } finally { try { await graph?.close(); } finally { await transport.close(); assert.equal(transport.activeRequests, 0); } }
    }
  }
  const pageDirectory = path.join(root, 'pagination'); await mkdir(pageDirectory);
  await writeFile(path.join(pageDirectory, 'provider.json'), JSON.stringify({ providerId: 'profile', name: 'Profile', version: '1' }));
  await writeFile(path.join(pageDirectory, 'paged.capability.json'), JSON.stringify({ capabilityId: 'paged', name: 'Paged source', description: 'Byte-exact pagination profile', whenToUse: 'Read source pages',
    knowledge: [{ kind: 'document', knowledgeId: 'PAGED', role: 'guide', locator: { type: 'http', url: `${origin}/paged` } }] }));
  const pagination = [];
  for (const stableProof of [false, true]) {
    const transport = new HttpKnowledgeReader({ allowedOrigins: [origin], snapshot: { directory: path.join(pageDirectory, 'snapshots') } });
    let streamCalls = 0; let streamedBytes = 0; let validations = 0; let graph;
    const reader = { id: 'paged-source', canRead: (ref) => transport.canRead(ref), read: (...args) => transport.read(...args),
      async *stream(...args) { streamCalls++; for await (const part of transport.stream(...args)) { streamedBytes += part.bytes.length; yield part; } },
      ...(stableProof ? { isContentCurrent: (...args) => { validations++; return transport.isContentCurrent(...args); } } : {}) };
    const before = { requests, servedBytes }; const started = performance.now();
    try {
      graph = await CapabilityGraph.open({ hostAllowedProviders: ['profile'], integrationEnabledProviders: ['profile'],
        providers: [{ providerId: 'profile', authority: { kind: 'file', rootDir: pageDirectory } }], readers: [reader] });
      let cursor; let text = ''; let pages = 0;
      do { const page = await graph.forProvider('profile').readDocumentPage({ capabilityId: 'paged', knowledgeId: 'PAGED', ...(cursor ? { cursor } : {}) });
        text += page.text; cursor = page.nextCursor; pages++; } while (cursor);
      assert.equal(text, pageBody.toString()); assert.equal(pages, 32); assert.equal(streamCalls, stableProof ? 1 : 32);
      assert.equal(streamedBytes, pageBody.length * streamCalls); assert.equal(transport.activeRequests, 0);
      pagination.push({ stableProof, sourceBytes: pageBody.length, pages, streamCalls, streamedBytes, validations,
        httpRequests: requests - before.requests, servedBytes: servedBytes - before.servedBytes, elapsedMs: performance.now() - started });
    } finally { await graph?.close(); await transport.close(); }
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, modelCalls: 0, results, pagination,
    limitation: 'Synthetic loopback workload. Cache-hit means reuse of this fixed selection lexical index, not avoided source reads: every query still verifies current source bytes. Cache bytes are conservative accounted values, not heap peaks. Body pages require strong revalidation to reuse snapshots; sources without that proof require complete scans. No production throughput or Agent success claim.' }, null, 2));
} finally {
  if (listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  assert.equal(sockets.size, 0); await rm(root, { recursive: true, force: true });
}
