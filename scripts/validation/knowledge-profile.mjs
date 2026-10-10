import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { HttpKnowledgeReader } from '../../dist-test/examples/seed-runtime/knowledge-reader.js';
import { TextKnowledgeRetriever } from '../../dist-test/examples/seed-runtime/text-retrieval.js';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';

// A transport profile, not an Agent or retrieval-quality benchmark. Owned HTTP I/O is measured.
const root = await createTemporaryDirectory('capability-graph-knowledge-profile-');
const bodies = Array.from({ length: 8 }, (_, i) => Buffer.from((`# Document ${i}\n\nneedle${i} 中文🙂 exact bytes\n\n`).repeat(4000)));
let requests = 0; let servedBytes = 0;
const sockets = new Set();
const server = createServer((req, res) => {
  const index = Number(req.url?.slice(1));
  if (!Number.isInteger(index) || !bodies[index]) { res.writeHead(404).end(); return; }
  requests++; servedBytes += bodies[index].length;
  res.setHeader('content-type', 'text/markdown; charset=utf-8'); res.end(bodies[index]);
});
server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
let listening = false;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); listening = true;
  const origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'profile', name: 'Profile', version: '1' }));
  for (let i = 0; i < bodies.length; i++) await writeFile(path.join(root, `${i}.capability.json`), JSON.stringify({
    capabilityId: `c${i}`, name: `Document ${i}`, description: 'Transport profile', whenToUse: 'Measure byte-exact knowledge I/O',
    knowledge: [{ kind: 'document', knowledgeId: `DOC${i}`, role: 'guide', locator: { type: 'http', url: `${origin}/${i}` } }],
  }));
  const results = [];
  for (const mode of ['read-only', 'streaming']) {
    const transport = new HttpKnowledgeReader({ allowedOrigins: [origin], timeoutMs: 5000 });
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
        providers: [{ providerId: 'profile', authority: { kind: 'file', rootDir: root } }], readers: [reader], knowledgeRetriever: new TextKnowledgeRetriever() });
      for (const count of [1, 8]) {
        const selected = bodies.slice(0, count).map((_, i) => ({ providerId: 'profile', capabilityId: `c${i}` }));
        const samples = [];
        for (let iteration = 0; iteration < 8; iteration++) {
          const before = { ...metrics, requests, servedBytes }; const start = performance.now();
          const text = iteration === 7 ? 'definitelymissingtoken' : 'needle0';
          const page = await graph.queryKnowledge({ selected, text, limit: 3 });
          const elapsedMs = performance.now() - start;
          assert.equal(page.meta.completeness, 'complete');
          assert.equal(page.items.length, iteration === 7 ? 0 : 3);
          for (const hit of page.items) {
            const body = bodies[Number(hit.id.capabilityId.slice(1))];
            assert.equal(body.subarray(hit.startOffset, hit.endOffset).toString('utf8'), hit.snippet);
          }
          samples.push({ phase: iteration === 0 ? 'cold' : iteration === 7 ? 'zero-hit' : 'cached', elapsedMs,
            readCalls: metrics.readCalls - before.readCalls, streamCalls: metrics.streamCalls - before.streamCalls,
            receivedBytes: metrics.receivedBytes - before.receivedBytes, httpRequests: requests - before.requests,
            servedBytes: servedBytes - before.servedBytes, responseBytes: Buffer.byteLength(JSON.stringify(page)) });
          assert.equal(transport.activeRequests, 0);
          assert.equal(requests - before.requests, count + (page.items.length ? 1 : 0), 'one shared verification request per hit document');
        }
        const sorted = samples.filter((sample) => sample.phase === 'cached').map((sample) => sample.elapsedMs).sort((a, b) => a - b);
        results.push({ mode, documents: count, documentBytes: bodies[0].length, samples,
          cachedP50Ms: sorted[Math.ceil(sorted.length * .5) - 1], cachedP95Ms: sorted[Math.ceil(sorted.length * .95) - 1] });
      }
    } finally { try { await graph?.close(); } finally { await transport.close(); assert.equal(transport.activeRequests, 0); } }
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, modelCalls: 0, results,
    limitation: 'Synthetic loopback workload with six warm samples per case. Full-source hashes still require full-source I/O; streaming bounds transfer buffers and avoids rebuilding cached lexical chunks. Do not infer production throughput or Agent success.' }, null, 2));
} finally {
  if (listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  assert.equal(sockets.size, 0); await rm(root, { recursive: true, force: true });
}
