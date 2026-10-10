import assert from 'node:assert/strict';
import { readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { TextCapabilityRetriever, TextKnowledgeRetriever } from '../../dist-test/examples/seed-runtime/text-retrieval.js';
import { createTemporaryDirectory, repositoryRoot } from '../lib/website-paths.mjs';
import { VextMcpClient } from '../../examples/vextjs/mcp-client.mjs';
import { exportVextProvider, readNativeCatalog, decodeNative, capabilityIdFor } from '../../examples/vextjs/native-provider.mjs';
import { VextNativeRuntimeAdapter } from '../../examples/vextjs/runtime-adapter.mjs';
import { verifyVextSource } from '../../examples/vextjs/source-provenance.mjs';
import { officialDocumentMappings } from '../../examples/vextjs/official-documents.mjs';
import { assertTaskRecall, assertKnowledgeEvidence } from './lib/retrieval-assertions.mjs';

/** Opt-in real framework validation. Run after building Core and examples, with an installed fixed Vext source. */
export async function validateVextjs({ frameworkRoot, projectRoot, sourceIdentity, sourceRoot = frameworkRoot }) {
  frameworkRoot = await realpath(frameworkRoot); projectRoot = await realpath(projectRoot);
  sourceRoot = await realpath(sourceRoot);
  const source = await verifyVextSource({ frameworkRoot, sourceRoot, sourceIdentity });
  const temporary = await createTemporaryDirectory('capability-graph-vextjs-');
  const client = new VextMcpClient({ cli: path.join(frameworkRoot, 'dist/cli/index.js'), projectRoot });
  let graph;
  try {
    await client.initialize();
    // Discovery artifact from the fixed installed snapshot, not an execution API. Every entry is read back over MCP.
    const { buildMcpCatalog } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/assistant/catalog.js')).href);
    const expected = buildMcpCatalog(); const catalog = await readNativeCatalog(client, expected);
    const version = JSON.parse(await readFile(path.join(frameworkRoot, 'package.json'), 'utf8')).version;
    const officialDocuments = await officialDocumentMappings(sourceRoot, catalog, source.commit);
    const exported = await exportVextProvider({ catalog, version, source, officialDocuments, outputDir: path.join(temporary, 'provider'), repositoryRoot });
    const recall = new TextCapabilityRetriever(); const knowledge = new TextKnowledgeRetriever();
    const runtime = new VextNativeRuntimeAdapter({ client, project: 'pilot', environment: 'verification', projectRoot });
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'],
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: exported.rootDir, definitionLayout: 'directory' },
        knowledgeRoots: { official: { kind: 'directory', rootDir: sourceRoot } } }], capabilityRetriever: recall, knowledgeRetriever: knowledge, runtimeAdapters: [runtime] });
    await recall.rebuild(graph);
    const tasks = JSON.parse(await readFile(new URL('../../test/fixtures/vextjs/retrieval-tasks.json', import.meta.url), 'utf8'));
    const results = []; let bytes = 0; const durations = [];
    for (const task of tasks) {
      for (const id of task.expected) assert(catalog.items.some((item) => item.id === id), `Independent task references missing source identity: ${id}`);
      const started = performance.now();
      const candidates = await graph.retrieveCapabilities({ text: task.query, limit: 10 });
      const duration = performance.now() - started; durations.push(duration);
      const native = decodeNative(await client.request('tools/call', { name: 'vext_knowledge_search', arguments: { query: task.query, limit: 10 } }));
      const found = candidates.items.map((item) => item.id.capabilityId);
      const hits = task.expected.filter((id) => found.includes(capabilityIdFor(id)));
      const nativeHits = task.expected.filter((id) => native.matches.some((item) => item.id === id));
      assertTaskRecall(task, found, native.matches.map((item) => item.id));
      const result = { ...task, candidateIds: found, nativeIds: native.matches.map((item) => item.id), recallAt10: task.expected.length ? hits.length / task.expected.length : null,
        nativeRecallAt10: task.expected.length ? nativeHits.length / task.expected.length : null, durationMs: duration,
        falseRecommendations: task.expected.length === 0 ? found.length : null };
      if (task.expected.length) {
        const selected = task.expected.map((id) => ({ providerId: 'vextjs', capabilityId: capabilityIdFor(id) }));
        const page = await graph.queryKnowledge({ selected, knowledgeIds: task.expected, text: task.query, limit: 3 });
        assertKnowledgeEvidence(page, task.id);
        result.knowledgeHits = page.items.length;
        for (const hit of page.items) {
          const body = await readFile(path.join(exported.rootDir, hit.source));
          assert.equal(body.subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
        }
        for (const id of task.expected) assertKnowledgeEvidence(await graph.queryKnowledge({ selected: [{ providerId: 'vextjs', capabilityId: capabilityIdFor(id) }], knowledgeIds: [id], text: task.query, limit: 1 }), `${task.id}/${id}`);
        bytes += Buffer.byteLength(JSON.stringify(page));
      }
      bytes += Buffer.byteLength(JSON.stringify(candidates)); results.push(result);
    }
    const observation = await graph.forProvider('vextjs').queryRuntime({ project: 'pilot', environment: 'verification', limit: 1 });
    assert.equal(observation.observation.compatibility, 'unknown'); assert.equal(observation.meta.completeness, 'partial');
    assert(observation.items.every((item) => item.facts.liveness === 'unverified'));
    const sorted = durations.sort((a, b) => a - b);
    return { node: process.version, platform: process.platform, sourceIdentity, source, officialDocuments, nativeCatalogDigest: catalog.digest, exportedCount: exported.count,
      kinds: Object.fromEntries([...new Set(catalog.items.map((item) => item.kind))].map((kind) => [kind, catalog.items.filter((item) => item.kind === kind).length])),
      modelCalls: 0, responseBytes: bytes, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
      results, runtime: { count: observation.items.length, observation: observation.observation },
      limitation: 'Deterministic lexical baseline; negation/synonyms can fail. Snapshot presence does not establish liveness. Knowledge IDs are discovered from the pinned installed snapshot because native MCP has no knowledge enumeration resource.' };
  } finally { try { await graph?.close(); } finally { try { await client.close(); } finally { await rm(temporary, { recursive: true, force: true }); } } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [frameworkRoot, projectRoot, sourceIdentity, sourceRoot] = process.argv.slice(2);
  if (!frameworkRoot || !projectRoot || !sourceIdentity) throw new Error('Usage: node scripts/validation/vextjs.mjs <fixed-installed-framework-root> <project-root> <source-identity>');
  console.log(JSON.stringify(await validateVextjs({ frameworkRoot, projectRoot, sourceIdentity, ...(sourceRoot ? { sourceRoot } : {}) }), null, 2));
}
