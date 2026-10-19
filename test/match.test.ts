import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph, GraphError } from '../src/index.js';
import type { ModelExecutor, ModelSelectRequest, ModelSelection, ProviderDefinition } from '../src/index.js';

const p = (id = 'acme'): ProviderDefinition => ({ providerId: id, name: id, version: '1', capabilities: [{ id: 'route', name: 'Route', description: 'Routing', relations: { requires: ['schema'] } }, { id: 'schema', name: 'Schema', description: 'Validation' }] });
const executor = (selection: unknown): ModelExecutor => ({ id: 'controlled', async select() { return selection as ModelSelection; } });
const create = (model?: ModelExecutor) => CapabilityGraph.open({ providers: [{ definition: p() }], ...(model ? { model } : {}) });
const error = (code: string) => (e: unknown) => e instanceof GraphError && e.code === code;

test('match validates executor configuration even for empty catalogs; configured empty never invokes select', async () => {
  const missing = await create(); await assert.rejects(missing.match({ input: 'route' }), error('CG_MODEL_NOT_CONFIGURED')); await missing.close();
  let calls = 0; const empty = await CapabilityGraph.open({ providers: [], model: { id: 'empty', async select(): Promise<never> { calls++; throw new Error(); } } });
  const result = await empty.match({ input: 'route' }); assert.equal(result.status, 'no_match'); assert.deepEqual(result.selection, { ids: [], missingInformation: [] }); assert.deepEqual(result.graph.nodes, []); assert.equal(calls, 0); await empty.close();
});
for (const [selection, status, roots] of [
  [{ decision: 'selected', ids: ['acme::route'] }, 'matched', ['acme::route']],
  [{ decision: 'selected', ids: ['acme::route', 'acme::schema'] }, 'matched', ['acme::route', 'acme::schema']],
  [{ decision: 'none', ids: [] }, 'no_match', []],
  [{ decision: 'ambiguous', ids: ['acme::route', 'acme::schema'], reason: 'Mutually exclusive alternatives for this request' }, 'ambiguous', ['acme::route', 'acme::schema']],
  [{ decision: 'needs_context', ids: [], reason: 'Missing framework', missingInformation: ['framework'] }, 'needs_context', []],
] as const) test(`public decision ${selection.decision} with ${selection.ids.length} roots maps to ${status}`, async () => {
  const graph = await create(executor(selection)); const result = await graph.match({ input: 'Create an API' });
  assert.equal(result.status, status); assert.deepEqual(result.selection.ids, roots); assert.deepEqual(result.selection.ids, result.graph.selected);
  if (selection.decision === 'selected') assert(result.graph.nodes.some(n => n.capability.id === 'acme::schema')); await graph.close();
});
test('matched status and unknown applicability remain independent', async () => {
  const definition = p(); definition.capabilities[0]!.appliesTo = { all: [{ field: 'framework', op: 'eq', value: 'acme' }] };
  const graph = await CapabilityGraph.open({ providers: [{ definition }], model: executor({ decision: 'selected', ids: ['acme::route'] }) });
  const result = await graph.match({ input: 'route' }); assert.equal(result.status, 'matched'); assert.equal(result.graph.nodes.find(n => n.origin === 'selected')!.applicability.status, 'unknown'); await graph.close();
});
test('model receives immutable, complete compact input and context without hidden data', async () => {
  let calls = 0; const definition = p(); definition.capabilities[0]!.usage = { instructions: 'Long body must not enter compact catalog' };
  const model: ModelExecutor = { id: 'inspect', async select(request) {
    calls++; assert.equal(request.catalog.length, 2); assert(Object.isFrozen(request.catalog)); assert(Object.isFrozen(request.context));
    assert(!JSON.stringify(request.catalog).includes('Long body')); assert(!JSON.stringify(request).includes('private'));
    assert.throws(() => { (request.catalog as any)[0].id = 'invented'; });
    return { decision: 'selected', ids: ['acme::route'] };
  } };
  const graph = await CapabilityGraph.open({ providers: [{ definition }, { definition: p('private') }], allowedProviders: ['acme'], model });
  await graph.match({ input: 'route', context: { facts: { framework: 'acme' } } }); assert.equal(calls, 1); await graph.close();
});
for (const [selection, code] of [
  [{ decision: 'selected', ids: [] }, 'CG_MODEL_OUTPUT_INVALID'],
  [{ decision: 'none', ids: ['acme::route'] }, 'CG_MODEL_OUTPUT_INVALID'],
  [{ decision: 'ambiguous', ids: ['acme::route'], reason: 'x' }, 'CG_MODEL_OUTPUT_INVALID'],
  [{ decision: 'needs_context', ids: [], reason: 'x', missingInformation: [] }, 'CG_MODEL_OUTPUT_INVALID'],
  [{ decision: 'selected', ids: ['acme::route'], extra: true }, 'CG_MODEL_OUTPUT_INVALID'],
  [{ decision: 'selected', ids: ['acme::route', 'acme::route'] }, 'CG_MODEL_INVALID_SELECTION'],
  [{ decision: 'selected', ids: ['acme::invented'] }, 'CG_MODEL_INVALID_SELECTION'],
  [{ decision: 'selected', ids: ['private::route'] }, 'CG_MODEL_INVALID_SELECTION'],
] as const) test(`bad selection ${JSON.stringify(selection)} fails ${code}`, async () => {
  const graph = await create(executor(selection)); await assert.rejects(graph.match({ input: 'route' }), error(code)); await graph.close();
});
test('candidate root filter does not hide authorized required dependencies', async () => {
  const a = p('a'), b = p('b'); a.capabilities[0]!.relations = { requires: ['b::schema'] };
  const graph = await CapabilityGraph.open({ providers: [{ definition: a }, { definition: b }], model: { id: 'scoped', async select(request) { assert(request.catalog.every(c => c.providerId === 'a')); return { decision: 'selected', ids: ['a::route'] }; } } });
  const result = await graph.match({ input: 'route', providers: ['a'] }); assert(result.graph.nodes.some(n => n.capability.id === 'b::schema')); await graph.close();
});
test('input/context/model directory and output budgets fail explicitly', async () => {
  const model = executor({ decision: 'selected', ids: ['acme::route'], reason: 'x'.repeat(500) });
  const createWith = (limits: any) => CapabilityGraph.open({ providers: [{ definition: p() }], model, limits });
  const input = await createWith({ maxInputBytes: 2 }); await assert.rejects(input.match({ input: '中文' }), error('CG_INPUT_TOO_LARGE')); await input.close();
  const context = await createWith({ maxContextBytes: 8 }); await assert.rejects(context.match({ input: 'x', context: { facts: { framework: 'acme' } } }), error('CG_INPUT_TOO_LARGE')); await context.close();
  const catalog = await createWith({ maxModelCatalogBytes: 1 }); await assert.rejects(catalog.match({ input: 'x' }), error('CG_MODEL_CONTEXT_EXCEEDED')); await catalog.close();
  const output = await createWith({ maxModelOutputBytes: 100 }); await assert.rejects(output.match({ input: 'x' }), error('CG_MODEL_OUTPUT_TOO_LARGE')); await output.close();
  const separate = await CapabilityGraph.open({ providers: [{ definition: p() }], model: executor({ decision: 'none', ids: [] }), limits: { maxCatalogBytes: 1 } }); await assert.rejects(separate.listCatalog(), error('CG_CATALOG_TOO_LARGE')); assert.equal((await separate.match({ input: 'x' })).status, 'no_match'); await separate.close();
});
test('pre-cancel, timeout and close terminate ignored signals; late results cannot win', async () => {
  let release!: (value: ModelSelection) => void; let started!: () => void; let request!: ModelSelectRequest;
  const began = new Promise<void>(resolve => { started = resolve; });
  const model: ModelExecutor = { id: 'non-cooperative', select(r) { request = r; started(); return new Promise(resolve => { release = resolve; }); } };
  const graph = await create(model); const controller = new AbortController();
  const pending = graph.match({ input: 'route' }, { signal: controller.signal }); const rejected = assert.rejects(pending, error('CG_MODEL_CANCELLED'));
  await began; controller.abort(); await rejected; assert(request.signal.aborted); release({ decision: 'selected', ids: ['acme::route'] });
  const timeoutGraph = await create({ id: 'never', select() { return new Promise(() => {}); } }); await assert.rejects(timeoutGraph.match({ input: 'route' }, { timeoutMs: 5 }), error('CG_MODEL_TIMEOUT')); await timeoutGraph.close();
  const closed = graph.match({ input: 'route' }); const closeError = assert.rejects(closed, error('CG_GRAPH_CLOSED')); await graph.close(); await closeError;
  const pre = await create(executor({ decision: 'none', ids: [] })); await assert.rejects(pre.match({ input: 'route' }, { signal: AbortSignal.abort() }), error('CG_MODEL_CANCELLED')); await pre.close();
});
test('first observed terminal reason wins across close and caller cancel', async () => {
  const graph = await create({ id: 'ignored', select() { return new Promise(() => {}); } }); const c = new AbortController();
  const operation = graph.match({ input: 'x' }, { signal: c.signal }); const rejected = assert.rejects(operation, error('CG_MODEL_CANCELLED')); c.abort(); await graph.close(); await rejected;
  const other = await create({ id: 'ignored', select() { return new Promise(() => {}); } }); const d = new AbortController();
  const another = other.match({ input: 'x' }, { signal: d.signal }); const closed = assert.rejects(another, error('CG_GRAPH_CLOSED')); await other.close(); d.abort(); await closed;
});
test('match pins the catalog revision while reload publishes a newer static view', async () => {
  const base = path.resolve(process.env.CG_TEST_DIR!); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'match-pin-'));
  let release!: (v: ModelSelection) => void; let started!: () => void; let revision = ''; const began = new Promise<void>(resolve => { started = resolve; });
  try {
    const definition = p(); const file = path.join(root, 'p.json'); await writeFile(file, JSON.stringify(definition));
    const graph = await CapabilityGraph.open({ providers: [{ file }], model: { id: 'pin', select(request) { revision = request.revision; started(); return new Promise(resolve => { release = resolve; }); } } });
    const pending = graph.match({ input: 'route' }); await began;
    definition.capabilities[0]!.name = 'Updated'; await writeFile(file, JSON.stringify(definition)); const reload = await graph.reload(); assert(reload.ok); assert.notEqual(reload.revision, revision);
    release({ decision: 'selected', ids: ['acme::route'] }); const matched = await pending;
    assert.equal(matched.graph.meta.revision, revision); assert.equal(matched.graph.nodes.find(n => n.origin === 'selected')!.capability.name, 'Route'); assert.equal((await graph.listCatalog()).items[0]!.name, 'Updated'); await graph.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('executor failures are distinguishable from no_match and redact arbitrary messages', async () => {
  const graph = await create({ id: 'failure', async select() { throw new Error('secret prompt and token'); } }); await assert.rejects(graph.match({ input: 'x' }), e => error('CG_MODEL_UNAVAILABLE')(e) && !(e as Error).message.includes('secret')); await graph.close();
  const refused = await create({ id: 'refusal', async select() { throw new GraphError('CG_MODEL_REFUSED', 'match', 'private model response'); } }); await assert.rejects(refused.match({ input: 'x' }), e => error('CG_MODEL_REFUSED')(e) && !(e as Error).message.includes('private')); await refused.close();
});
test('match rejects explicit invalid timeout values before calling a borrowed executor', async () => {
  let calls = 0;
  const graph = await create({ id: 'invalid-timeout', async select() { calls++; return { decision: 'none', ids: [] }; } });
  try {
    for (const timeoutMs of [null, false, 0, '60000', NaN]) await assert.rejects(graph.match({ input: 'route' }, { timeoutMs } as unknown as Parameters<CapabilityGraph['match']>[1]), error('CG_INPUT_INVALID'));
    assert.equal(calls, 0);
    assert.equal((await graph.match({ input: 'route' })).status, 'no_match'); assert.equal(calls, 1);
  } finally { await graph.close(); }
});
