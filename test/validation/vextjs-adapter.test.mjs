import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory, repositoryRoot } from '../../scripts/lib/website-paths.mjs';
import { exportVextProvider } from '../../examples/vextjs/native-provider.mjs';
import { VextNativeRuntimeAdapter } from '../../examples/vextjs/runtime-adapter.mjs';

test('native Provider preserves roles, stable source identities and optional context without inventing execution or requires', async () => {
  const root = await createTemporaryDirectory('capability-graph-vext-contract-');
  const catalog = { digest: 'fixed-native-digest', items: ['capability', 'rule', 'recipe', 'knowledge', 'workflow'].map((kind, i) => ({ id: `ID${i}`, kind, title: kind, summary: 'Native guidance', body: 'exact source', status: 'partial', sourceRefs: ['vext://catalog/capabilities'], relatedIds: i ? ['ID0'] : [] })) };
  const options = { catalog, version: '2.0.0', source: { identity: 'fixed-source' }, repositoryRoot };
  let graph;
  try {
    const a = await exportVextProvider({ ...options, outputDir: path.join(root, 'a') });
    const b = await exportVextProvider({ ...options, outputDir: path.join(root, 'b') });
    assert.deepEqual(a.manifest, b.manifest);
    for (const item of catalog.items) assert.deepEqual(await readFile(path.join(a.rootDir, 'capabilities', `native.${item.id.toLowerCase()}.json`)), await readFile(path.join(b.rootDir, 'capabilities', `native.${item.id.toLowerCase()}.json`)));
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'], providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: a.rootDir, definitionLayout: 'directory' } }] });
    const detail = await graph.forProvider('vextjs').getCapabilities(['native.id2']); assert(detail.results[0].ok);
    const selection = await graph.forProvider('vextjs').resolveSelection({ selected: ['native.id2'] }); assert.equal(selection.added.length, 0);
    const page = await graph.forProvider('vextjs').readDocumentPage({ capabilityId: 'native.id2', knowledgeId: 'ID2' }); assert.match(page.text, /exact source/); assert(page.complete);
    await assert.rejects(exportVextProvider({ ...options, catalog: { ...catalog, items: [{ ...catalog.items[0], id: '../escape' }] }, outputDir: path.join(root, 'bad') }), /Invalid native catalog/);
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(repositoryRoot, 'bad') }), /outside/);
  } finally { await graph?.close(); await rm(root, { recursive: true, force: true }); }
});

test('native stopped snapshots remain partial and unverified; revision binding rejects drift and wrong project', async () => {
  let state = 'stopped'; let sourceRevision = 'new';
  const client = { async request(_method, params) { return { structuredContent: { schemaVersion: 2, status: 'ok',
    ...(params.name === 'vext_project_inspect' ? { identity: { rootDir: '/owned' } } : { data: { projectIdentity: { rootDir: '/owned', sourceRevision }, instances: [1, 2].map((i) => ({ instanceId: `i${i}`, runtimeIdentity: { mode: 'production', sourceRevision: null }, summary: { state }, counts: { workers: 0 }, evidence: { liveness: 'unverified', ownership: 'verified', sourceFreshness: 'unverified' } })) } }) } }; } };
  const adapter = new VextNativeRuntimeAdapter({ client, project: 'p', environment: 'e', projectRoot: '/owned' });
  const input = { project: 'p', environment: 'e', currentStaticRevision: 'query-revision', limit: 1 };
  const first = await adapter.query(input); assert.equal(first.observation.compatibility, 'unknown'); assert.equal(first.observation.observedAgainstStaticRevision, 'unverified'); assert.equal(first.instances[0].facts.state, 'stopped'); assert(first.nextCursor);
  assert.equal((await adapter.query({ ...input, instanceId: 'missing' })).instances.length, 0);
  await assert.rejects(adapter.query({ ...input, project: 'other' }), { code: 'CG_RUNTIME_RESULT_MISMATCH' });
  sourceRevision = 'edited-project'; await assert.rejects(adapter.query({ ...input, cursor: first.nextCursor }), { code: 'CG_REVISION_MISMATCH' });
  sourceRevision = 'new'; state = 'running'; await assert.rejects(adapter.query({ ...input, cursor: first.nextCursor }), { code: 'CG_REVISION_MISMATCH' });
  const root = await createTemporaryDirectory('capability-graph-vext-public-runtime-');
  let graph;
  try {
    const exported = await exportVextProvider({ outputDir: path.join(root, 'provider'), repositoryRoot, version: '2.0.0',
      source: { identity: 'controlled-contract-fixture' }, catalog: { digest: 'controlled-catalog', items: [
        { id: 'C18', kind: 'capability', title: 'Native runtime', summary: 'Contract fixture', body: 'Fixture', status: 'partial', sourceRefs: [], relatedIds: [] },
      ] } });
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'],
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: exported.rootDir, definitionLayout: 'directory' } }], runtimeAdapters: [adapter] });
    const provider = graph.forProvider('vextjs');
    const page = await provider.queryRuntime({ project: 'p', environment: 'e', limit: 1 }); assert(page.nextCursor);
    sourceRevision = 'public-source-change';
    await assert.rejects(provider.queryRuntime({ project: 'p', environment: 'e', limit: 1, cursor: page.nextCursor }), (error) => {
      assert.equal(error.code, 'CG_REVISION_MISMATCH'); assert.equal(error.nextAction, 'refresh');
      assert.equal(JSON.stringify(error).includes('/owned'), false); return true;
    });
  } finally { await graph?.close(); await rm(root, { recursive: true, force: true }); }
});
