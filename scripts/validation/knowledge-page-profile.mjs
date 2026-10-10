import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { HttpKnowledgeReader } from '../../dist-test/examples/seed-runtime/knowledge-reader.js';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';

const inputArgs = process.argv.slice(2);
const scenarioName = inputArgs[0] === '--scenario' ? inputArgs[1] : undefined;
const args = scenarioName ? inputArgs.slice(2) : inputArgs;
assert(args.length === 0 || (args.length === 2 && args[0] === '--baseline-core' && path.isAbsolute(args[1])), 'Usage: knowledge-page-profile.mjs [--baseline-core /absolute/dist/index.js]');
const baseline = args.length ? (await import(pathToFileURL(args[1]))).CapabilityGraph : undefined;
const cases = [
  ...(baseline ? [{ name: 'baseline-range-reader', implementation: baseline, proof: true, pages: 160 }] : []),
  { name: 'current-range-reader', implementation: CapabilityGraph, proof: true, pages: 160 },
  { name: 'current-unproved-fallback', implementation: CapabilityGraph, proof: false, pages: 3 },
];
const limitation = 'Synthetic controlled loopback source, zero model calls. Each scenario runs in a fresh child process with the same module inputs. Complete source scans and aligned range reads are separate counters. Memory peaks are sampled process observations, including fixture/server/consumer allocations, not retained-cache sizes or guaranteed maxima. Concurrent queries use this Reader maxConcurrent=8. No production throughput claim. Unproved fallback intentionally stops after three pages.';
if (!scenarioName) {
  const execute = promisify(execFile); const results = [];
  for (const scenario of cases) {
    const { stdout } = await execute(process.execPath, [
      ...(global.gc ? ['--expose-gc'] : []), fileURLToPath(import.meta.url), '--scenario', scenario.name, ...args,
    ], { env: process.env, timeout: 120000, maxBuffer: 2_097_152 });
    const report = JSON.parse(stdout); assert.equal(report.node, process.version); assert.equal(report.results.length, 1);
    assert.equal(report.results[0].name, scenario.name); results.push(...report.results);
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, modelCalls: 0, results, limitation }, null, 2));
} else {
  assert(cases.some((scenario) => scenario.name === scenarioName), 'Unknown internal scenario');
  const root = await createTemporaryDirectory('knowledge-page-profile-');
  const body = Buffer.alloc(5_242_880, 120);
  const contentId = `k:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
  let requests = 0; let servedBytes = 0;
  const server = createServer((req, res) => {
    requests++; res.setHeader('etag', '"fixed-body"'); res.setHeader('content-type', 'text/plain');
    if (req.headers['if-none-match'] === '"fixed-body"') { res.writeHead(304).end(); return; }
    if (req.method === 'GET') servedBytes += body.length;
    res.end(body);
  });
  const memory = () => {
    const { heapUsed, external, arrayBuffers, rss } = process.memoryUsage(); return { heapUsed, external, arrayBuffers, rss };
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'profile', name: 'Profile', version: '1' }));
    await writeFile(path.join(root, 'body.capability.json'), JSON.stringify({ capabilityId: 'body', name: 'Body', description: 'Exact pagination', whenToUse: 'Read bounded pages',
      knowledge: [{ kind: 'document', knowledgeId: 'DOC', role: 'guide', locator: { type: 'http', url: origin + '/body' } }] }));
    const results = [];
    for (const scenario of cases.filter((item) => item.name === scenarioName)) {
      const transport = new HttpKnowledgeReader({ allowedOrigins: [origin], maxConcurrent: 8, snapshot: { directory: path.join(root, 'snapshots'), maxBytes: 6_291_456, maxEntries: 1 } });
      const metrics = { scans: 0, scannedBytes: 0, rangeCalls: 0, rangeBytes: 0, validations: 0 };
      const reader = { id: 'profile-source', canRead: (ref) => transport.canRead(ref), read: (...args) => transport.read(...args),
        async *stream(...args) { metrics.scans++; for await (const part of transport.stream(...args)) { metrics.scannedBytes += part.bytes.length; yield part; } },
        ...(scenario.proof ? { isContentCurrent: (...args) => { metrics.validations++; return transport.isContentCurrent(...args); },
          readRange: async (...args) => { metrics.rangeCalls++; const range = await transport.readRange(...args); metrics.rangeBytes += range?.bytes.length ?? 0; return range; } } : {}) };
      let graph; let timer;
      try {
        graph = await scenario.implementation.open({ hostAllowedProviders: ['profile'], integrationEnabledProviders: ['profile'], readers: [reader],
          providers: [{ providerId: 'profile', authority: { kind: 'file', rootDir: root } }] });
        global.gc?.(); const initialMemory = memory(); const peak = { ...initialMemory };
        const sample = () => { const now = memory(); for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], now[key]); };
        timer = setInterval(sample, 5);
        const before = { requests, servedBytes }; const started = performance.now();
        const bound = graph.forProvider('profile'); const query = { capabilityId: 'body', knowledgeId: 'DOC' };
        let cursor; let offset = 0; let pages = 0;
        do {
          const page = await bound.readDocumentPage({ ...query, ...(cursor ? { cursor } : {}) });
          assert.equal(page.startOffset, offset); assert.equal(page.contentId, contentId); assert.equal(page.totalBytes, body.length);
          assert.deepEqual(Buffer.from(page.text), body.subarray(page.startOffset, page.endOffset));
          assert(page.byteLength <= 32768); cursor = page.nextCursor; offset = page.endOffset; pages++;
        } while (cursor && pages < scenario.pages);
        const elapsedMs = performance.now() - started; sample(); clearInterval(timer); timer = undefined;
        if (scenario.pages === 160) { assert.equal(pages, 160); assert.equal(offset, body.length); assert.equal(cursor, undefined); }
        else { assert.equal(pages, 3); assert(cursor); assert.equal(metrics.scans, 3); }
        if (scenario.name === 'current-range-reader') {
          assert.equal(metrics.scans, 1); assert.equal(metrics.scannedBytes, body.length); assert.equal(metrics.rangeCalls, 159);
        }
        const primary = { ...metrics }; const primaryRequests = requests - before.requests;
        const primaryServedBytes = servedBytes - before.servedBytes;
        const concurrentStart = performance.now(); const beforeConcurrent = { ...metrics };
        const concurrentInitialMemory = memory(); const concurrentPeak = { ...concurrentInitialMemory };
        const sampleConcurrent = () => { const now = memory(); for (const key of Object.keys(concurrentPeak)) concurrentPeak[key] = Math.max(concurrentPeak[key], now[key]); };
        timer = setInterval(sampleConcurrent, 5);
        const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) => bound.readDocumentPage({ ...query, startOffset: index * 32768 })));
        concurrent.forEach((page) => assert.deepEqual(Buffer.from(page.text), body.subarray(page.startOffset, page.endOffset)));
        sampleConcurrent(); clearInterval(timer); timer = undefined;
        assert.equal(transport.activeRequests, 0); assert(transport.cachedSnapshotBytes <= 6_291_456);
        results.push({ name: scenario.name, sourceBytes: body.length, pages, returnedBytes: offset, sourceFullyCovered: !cursor,
          ...primary, httpRequests: primaryRequests, servedBytes: primaryServedBytes, elapsedMs,
          initialMemory, peakObservedMemory: peak,
          concurrent: { queries: concurrent.length, elapsedMs: performance.now() - concurrentStart,
            scans: metrics.scans - beforeConcurrent.scans, rangeCalls: metrics.rangeCalls - beforeConcurrent.rangeCalls,
            initialMemory: concurrentInitialMemory, peakObservedMemory: concurrentPeak },
          cachedDiskBytes: transport.cachedSnapshotBytes });
      } finally { clearInterval(timer); try { await graph?.close(); } finally { await transport.close(); assert.equal(transport.activeRequests, 0); } }
    }
    console.log(JSON.stringify({ node: process.version, platform: process.platform, modelCalls: 0, results, limitation }, null, 2));
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true });
  }
}
