import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph, GraphError } from '../src/index.js';
import type { ProviderDefinition, ResolveResult, OpenOptions, CapabilityRelations } from '../src/index.js';

const provider = (id = 'acme'): ProviderDefinition => ({ providerId: id, name: id, version: '1.0.0', capabilities: [{ id: 'route', name: 'Route', description: 'Declare HTTP routes' }] });
const open = (definitions: ProviderDefinition[], options: Omit<OpenOptions, 'providers'> = {}) => CapabilityGraph.open({ providers: definitions.map(definition => ({ definition })), ...options });
const error = (code: string) => (e: unknown) => e instanceof GraphError && e.code === code;
test('resolve defaults only an omitted relations field; explicit empty and invalid values are distinct', async () => {
  const relations: CapabilityRelations = { requires: ['schema'] };
  const p = provider(); p.capabilities[0]!.relations = relations; p.capabilities.push({ id: 'schema', name: 'Schema', description: 'Dependency' });
  const graph = await open([p]);
  try {
    assert.equal((await graph.resolve({ ids: ['acme::route'] })).nodes.length, 2);
    assert.equal((await graph.resolve({ ids: ['acme::route'], relations: [] })).nodes.length, 1);
    for (const invalid of [null, false, 0, '', {}]) await assert.rejects(graph.resolve({ ids: ['acme::route'], relations: invalid } as unknown as Parameters<CapabilityGraph['resolve']>[0]), error('CG_INPUT_INVALID'));
  } finally { await graph.close(); }
});
function invariant(result: ResolveResult): void {
  const ids = result.nodes.map(n => n.capability.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(result.selected.length, new Set(result.selected).size);
  for (const id of result.selected) assert(ids.includes(id));
  for (const n of result.nodes) assert.equal(n.origin === 'selected', result.selected.includes(n.capability.id));
  const edges = result.edges.map(e => JSON.stringify(e));
  assert.equal(edges.length, new Set(edges).size);
  for (const e of result.edges) assert(ids.includes(e.from) && ids.includes(e.to));
  for (const e of result.unresolved) { assert(ids.includes(e.from)); assert(!result.edges.some(r => r.from === e.from && r.type === e.type && r.to === e.to)); }
  assert.equal(result.meta.completeness, result.unresolved.length ? 'partial' : 'complete');
}

test('empty and minimum inline Providers work without any model dependency', async () => {
  const empty = await open([]);
  assert.deepEqual((await empty.listProviders()).items, []); assert.deepEqual((await empty.listCatalog()).items, []);
  await assert.rejects(empty.resolve({ ids: [] }), error('CG_INPUT_INVALID'));
  await assert.rejects(empty.getCapabilities({ ids: ['absent::route'] }), error('CG_PROVIDER_NOT_FOUND'));
  await empty.close();
  const graph = await open([provider()]);
  const catalog = await graph.listCatalog();
  assert.deepEqual(catalog.items, [{ id: 'acme::route', providerId: 'acme', name: 'Route', description: 'Declare HTTP routes' }]);
  const result = await graph.resolve({ ids: ['acme::route', 'acme::route'] });
  invariant(result); assert.deepEqual(result.selected, ['acme::route']);
  assert.deepEqual(result.nodes[0]!.capability.relations, { parents: [], specializes: [], related: [], requires: [] });
  assert.deepEqual(result.nodes[0]!.capability.documents, []);
  assert.equal(result.nodes[0]!.applicability.status, 'applicable');
  await graph.close();
});

test('single UTF-8 JSON file Provider loads; errors never expose its absolute source path', async () => {
  const base = path.resolve(process.env.CG_TEST_DIR!); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'provider-'));
  try {
    const definition = provider(); definition.capabilities[0]!.documents = [{ id: '中文说明', source: { type: 'file', path: './guide.md' } }];
    const file = path.join(root, 'provider.json'); await writeFile(file, JSON.stringify(definition));
    const graph = await CapabilityGraph.open({ providers: [{ file }] });
    assert.equal((await graph.getCapabilities({ ids: ['acme::route'] })).items[0]!.capability.documents[0]!.id, '中文说明');
    await graph.close(); await writeFile(file, '{');
    await assert.rejects(CapabilityGraph.open({ providers: [{ file }] }), e => error('CG_DEFINITION_INVALID')(e) && !(e as Error).message.includes(root));
    await writeFile(file, 'x'.repeat(1025));
    await assert.rejects(CapabilityGraph.open({ providers: [{ file }], limits: { maxProviderBytes: 1024 } }), error('CG_DEFINITION_INVALID'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [label, alter] of [
  ['unknown Provider field', (p: any) => { p.extra = 1; }],
  ['unknown capability field', (p: any) => { p.capabilities[0].execute = 'do not run'; }],
  ['bad Provider ID', (p: any) => { p.providerId = 'Acme'; }],
  ['bad capability ID', (p: any) => { p.capabilities[0].id = 'acme::route'; }],
  ['blank name', (p: any) => { p.name = '  '; }],
  ['duplicate capability', (p: any) => { p.capabilities.push({ ...p.capabilities[0] }); }],
  ['unknown schema version', (p: any) => { p.schemaVersion = 2; }],
  ['unsafe document path', (p: any) => { p.capabilities[0].documents = [{ id: 'guide', source: { type: 'file', path: '../secret' } }]; }],
  ['Windows unsafe document path', (p: any) => { p.capabilities[0].documents = [{ id: 'guide', source: { type: 'file', path: 'C:\\private\\secret' } }]; }],
  ['non-HTTPS reference', (p: any) => { p.capabilities[0].documents = [{ id: 'guide', source: { type: 'url', url: 'http://example.com' } }]; }],
  ['duplicate document ID', (p: any) => { p.capabilities[0].documents = Array(2).fill({ id: 'guide', source: { type: 'file', path: 'guide.md' } }); }],
  ['executable contract URI', (p: any) => { p.capabilities[0].usage = { contract: { format: 'other', uri: 'javascript:alert(1)' } }; }],
] as const) test(`Provider rejects ${label}`, async () => {
  const p = provider(); alter(p); await assert.rejects(open([p]), error('CG_DEFINITION_INVALID'));
});

test('getter, toJSON, proxy, cycles, sparse arrays and nonfinite data are rejected without callbacks', async () => {
  let touches = 0;
  const getter = provider(); Object.defineProperty(getter.capabilities[0], 'name', { enumerable: true, get() { touches++; return 'bad'; } });
  const toJSON = Object.assign(provider(), { toJSON() { touches++; return {}; } });
  const proxy = new Proxy(provider(), { ownKeys() { touches++; return []; }, get() { touches++; return undefined; }, getPrototypeOf() { touches++; return null; } });
  const cycle: any = provider(); cycle.extra = cycle;
  const sparse: any = provider(); sparse.capabilities = new Array(1);
  const nonfinite: any = provider(); nonfinite.version = Infinity;
  for (const value of [getter, toJSON, proxy, cycle, sparse, nonfinite]) await assert.rejects(open([value]), error('CG_DEFINITION_INVALID'));
  assert.equal(touches, 0);
});

test('invalid source configurations and limits fail before publishing any Graph', async () => {
  for (const value of [{ providers: null }, { providers: [{ file: 'a', definition: provider() }] }, { providers: [{ file: 'a', documentRoot: 'b' }] }, { providers: [{}] }, { providers: [], limits: { maxResultBytes: 0 } }, { providers: [], limits: { unknown: 2 } }]) await assert.rejects(CapabilityGraph.open(value as any), error('CG_CONFIG_INVALID'));
  await assert.rejects(open([provider(), provider()]), error('CG_DEFINITION_INVALID'));
  const p = provider('empty'); p.capabilities = [];
  const graph = await open([p]); assert.equal((await graph.listProviders()).items[0]!.capabilityCount, 0); await graph.close();
});

test('requires closure, shared dependencies, roots and original-direction edges satisfy invariants', async () => {
  const p = provider(); p.capabilities = [
    { id: 'a', name: 'A', description: 'A', relations: { requires: ['shared', 'b', 'shared'], related: ['related'] } },
    { id: 'b', name: 'B', description: 'B', relations: { requires: ['shared'] } },
    { id: 'shared', name: 'Shared', description: 'S' },
    { id: 'related', name: 'Related', description: 'R', relations: { requires: ['unrelated'] } },
    { id: 'unrelated', name: 'Unrelated', description: 'U' },
  ];
  const graph = await open([p]);
  const result = await graph.resolve({ ids: ['acme::b', 'acme::a', 'acme::b'], relations: ['requires', 'related', 'requires'] });
  invariant(result); assert.deepEqual(result.selected, ['acme::b', 'acme::a']);
  assert.deepEqual(result.nodes.map(n => [n.capability.id, n.origin]), [['acme::a', 'selected'], ['acme::b', 'selected'], ['acme::related', 'relation'], ['acme::shared', 'dependency']]);
  assert(!result.nodes.some(n => n.capability.id === 'acme::unrelated'));
  const roots = await graph.resolve({ ids: ['acme::a'], relations: [] }); invariant(roots); assert.equal(roots.nodes.length, 1); assert.deepEqual(roots.edges, []);
  const reverse = await graph.resolve({ ids: ['acme::shared'], relations: ['requiredBy'] }); invariant(reverse);
  assert(reverse.edges.every(e => e.to === 'acme::shared' && e.type === 'requires')); assert.equal(reverse.edges.length, 2);
  await graph.close();
});

for (const kind of ['parents', 'specializes', 'requires'] as const) test(`${kind} rejects cross-Provider cycles`, async () => {
  const a = provider('a'), b = provider('b'); a.capabilities[0]!.relations = { [kind]: ['b::route'] }; b.capabilities[0]!.relations = { [kind]: ['a::route'] };
  await assert.rejects(open([a, b]), error('CG_RELATION_CYCLE'));
});
test('related is directed, may cycle, and reverses preserve original edges', async () => {
  const a = provider('a'), b = provider('b'); a.capabilities[0]!.relations = { related: ['b::route'] }; b.capabilities[0]!.relations = { related: ['a::route'] };
  const graph = await open([a, b]); const result = await graph.resolve({ ids: ['a::route'], relations: ['relatedBy'] }); invariant(result);
  assert.deepEqual(result.edges, [{ from: 'b::route', type: 'related', to: 'a::route' }]); await graph.close();
});

test('unloaded/unauthorized external targets are generic partial; loaded bad endpoints fail', async () => {
  const a = provider('a'); a.capabilities[0]!.relations = { requires: ['b::route'] };
  const unloaded = await open([a]); const hidden = await open([a, provider('b')], { allowedProviders: ['a'] });
  for (const g of [unloaded, hidden]) { const r = await g.resolve({ ids: ['a::route'] }); invariant(r); assert.equal(r.nodes.length, 1); assert.deepEqual(r.unresolved, [{ from: 'a::route', type: 'requires', to: 'b::route', reason: 'target_unavailable' }]); await g.close(); }
  const wrong = provider('b'); wrong.capabilities = [];
  await assert.rejects(open([a, wrong]), error('CG_RELATION_INVALID'));
});
test('unauthorized reverse sources are completely hidden and hidden updates do not change Revision', async () => {
  const publicProvider = provider('public'); const privateProvider = provider('private'); privateProvider.capabilities[0]!.relations = { requires: ['public::route'] };
  const a = await open([publicProvider, privateProvider], { allowedProviders: ['public'] });
  privateProvider.version = '999.0.0'; privateProvider.capabilities[0]!.description = 'Private changed';
  const b = await open([publicProvider, privateProvider], { allowedProviders: ['public'] });
  assert.deepEqual(await a.resolve({ ids: ['public::route'], relations: ['requiredBy'] }), await b.resolve({ ids: ['public::route'], relations: ['requiredBy'] }));
  const r = await a.resolve({ ids: ['public::route'], relations: ['requiredBy'] }); assert.equal(r.nodes.length, 1); assert.equal(r.meta.completeness, 'complete'); assert.deepEqual(r.meta.warnings, []);
  for (const id of ['private::route', 'never_loaded::route']) await assert.rejects(a.resolve({ ids: [id] }), error('CG_ACCESS_DENIED'));
  assert.deepEqual((await a.listCatalog()).items.map(x => x.providerId), ['public']); await a.close(); await b.close();
});
test('explicit scopes shrink only, empty is empty; explicit roots fail atomically', async () => {
  const graph = await open([provider('a'), provider('b')]);
  assert.equal((await graph.listCatalog({ providers: ['a', 'a'] })).items.length, 1);
  assert.deepEqual((await graph.listCatalog({ providers: [] })).items, []);
  await assert.rejects(graph.getCapabilities({ ids: ['a::route', 'a::missing'] }), error('CG_CAPABILITY_NOT_FOUND'));
  await assert.rejects(graph.resolve({ ids: ['route'] }), error('CG_INPUT_INVALID'));
  await assert.rejects(graph.resolve({ ids: ['a::route'], relations: ['invented'] as any }), error('CG_INPUT_INVALID'));
  await assert.rejects(graph.listCatalog({ providers: ['missing'] }), error('CG_PROVIDER_NOT_FOUND'));
  const denied = await open([provider()], { allowedProviders: [] }); assert.deepEqual((await denied.listProviders()).items, []); await denied.close(); await graph.close();
});

test('typed applicability reports unknown, invalid facts and known-failure priority', async () => {
  const p = provider(); p.capabilities[0]!.appliesTo = { all: [
    { field: '框架', op: 'eq', value: 'acme' }, { field: 'enabled', op: 'in', values: [true, 'yes'] }, { field: 'version', op: 'semverRange', range: '>=1.0.0 <2.0.0' },
  ] };
  const graph = await open([p]);
  const evaluate = async (facts: Record<string, string | number | boolean>) => (await graph.getCapabilities({ ids: ['acme::route'], context: { facts, notes: 'notes never grant facts' } })).items[0]!.applicability;
  assert.equal((await evaluate({})).status, 'unknown');
  assert.equal((await evaluate({ '框架': 'acme', enabled: true, version: '1.2.3' })).status, 'applicable');
  assert.equal((await evaluate({ '框架': 'acme', enabled: 'true', version: '1.2.3' })).status, 'inapplicable');
  const invalid = await evaluate({ version: '1.2.3-beta' }); assert.equal(invalid.status, 'unknown'); assert.deepEqual(invalid.invalidFacts, ['version']);
  const failed = await evaluate({ enabled: false }); assert.equal(failed.status, 'inapplicable'); assert.deepEqual(failed.failedConditions, ['enabled']);
  for (const facts of [{ x: null }, { x: [] }, { x: Infinity }, { '': 'x' }]) await assert.rejects(graph.getCapabilities({ ids: ['acme::route'], context: { facts } as any }), error('CG_CONTEXT_INVALID'));
  await graph.close();
});
test('an explicitly empty membership set is valid and matches no provided fact', async () => {
  const p = provider(); p.capabilities[0]!.appliesTo = { all: [{ field: 'framework', op: 'in', values: [] }] };
  const graph = await open([p]);
  assert.equal((await graph.getCapabilities({ ids: ['acme::route'], context: { facts: { framework: 'acme' } } })).items[0]!.applicability.status, 'inapplicable');
  await graph.close();
});
for (const range of ['^1.0.0', '~1.0.0', '*', '1.0.0 || 2.0.0', '1.0.0-beta', '1.0.0+build', '01.0.0']) test(`unsupported SemVer range ${range} fails at load`, async () => {
  const p = provider(); p.capabilities[0]!.appliesTo = { all: [{ field: 'version', op: 'semverRange', range }] }; await assert.rejects(open([p]), error('CG_DEFINITION_INVALID'));
});
test('budgets fail explicitly without returning a truncated catalog', async () => {
  const catalog = await open([provider()], { limits: { maxCatalogBytes: 1 } }); await assert.rejects(catalog.listCatalog(), error('CG_CATALOG_TOO_LARGE')); await catalog.close();
  const result = await open([provider()], { limits: { maxResultBytes: 1 } }); await assert.rejects(result.resolve({ ids: ['acme::route'] }), error('CG_RESULT_TOO_LARGE')); await result.close();
  const ctx = await open([provider()], { limits: { maxContextBytes: 32 } }); await assert.rejects(ctx.getCapabilities({ ids: ['acme::route'], context: { notes: '中'.repeat(100) } }), error('CG_INPUT_TOO_LARGE')); await ctx.close();
  await assert.rejects(open([provider()], { limits: { maxProviderBytes: 1 } }), error('CG_DEFINITION_INVALID'));
});
test('input and result mutation never reaches private snapshot state', async () => {
  const p = provider(); p.capabilities[0]!.usage = { examples: ['first', 'second'] };
  const graph = await open([p]); const before = await graph.getCapabilities({ ids: ['acme::route'] });
  p.name = 'changed'; p.capabilities[0]!.description = 'changed'; p.capabilities[0]!.usage!.examples!.reverse();
  const result = await graph.getCapabilities({ ids: ['acme::route'] }); result.items[0]!.capability.name = 'changed'; result.items[0]!.capability.relations.requires.push('acme::injected');
  assert.deepEqual(await graph.getCapabilities({ ids: ['acme::route'] }), before); assert.deepEqual(Object.keys(graph), []);
  await graph.close();
});
test('revision ignores capability/target order and source layout; preserves example order', async () => {
  const p = provider(); p.capabilities[0]!.relations = { related: ['b', 'c'] }; p.capabilities[0]!.usage = { examples: ['first', 'second'] };
  p.capabilities.push({ id: 'b', name: 'B', description: 'B' }, { id: 'c', name: 'C', description: 'C' });
  const a = await open([p]); const revision = (await a.listCatalog()).meta.revision;
  p.capabilities.reverse(); p.capabilities.find(c => c.id === 'route')!.relations!.related!.reverse(); p.schemaVersion = 1;
  const b = await open([p]); assert.equal((await b.listCatalog()).meta.revision, revision);
  p.capabilities.find(c => c.id === 'route')!.usage!.examples!.reverse(); const c = await open([p]); assert.notEqual((await c.listCatalog()).meta.revision, revision);
  await a.close(); await b.close(); await c.close();
});
test('close is idempotent, rejects new work, and never closes an external executor', async () => {
  let invoked = 0; const model = { id: 'external', async select(): Promise<never> { invoked++; throw new Error('Must not run'); }, close() { invoked++; } };
  const graph = await open([provider()], { model }); await graph.close(); await graph.close();
  await assert.rejects(graph.listCatalog(), error('CG_GRAPH_CLOSED')); assert.equal(invoked, 0);
});
