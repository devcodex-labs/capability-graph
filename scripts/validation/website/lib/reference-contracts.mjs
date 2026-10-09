import { createTemporaryDirectory } from '../../../lib/website-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { CapabilityGraph, isId, isKnowledgeId } from '../../../../dist/index.js';
import { DEFAULT_BUDGETS } from '../../../../dist/budgets.js';

function rowsAfter(source, heading) {
  const start = source.indexOf(heading);
  assert(start !== -1, `missing reference heading: ${heading}`);
  const table = source.slice(start).match(/(?:^\|[^\n]+\n)+/m)?.[0];
  assert(table, `missing reference table: ${heading}`);
  return table.trim().split('\n').slice(2).map((line) =>
    line.slice(1, -1).split('|').map((cell) => cell.trim()));
}

function jsonFence(source, title) {
  const marker = '```json title="' + title + '"\n';
  const start = source.indexOf(marker);
  assert(start !== -1, `missing reference example: ${title}`);
  const end = source.indexOf('\n```', start + marker.length);
  assert(end !== -1, `unterminated reference example: ${title}`);
  return JSON.parse(source.slice(start + marker.length, end));
}

const provider = { providerId: 'acme.http', name: 'Acme HTTP', version: '0.1.0' };
const capability = { capabilityId: 'route', name: 'Routing',
  description: 'Route requests.', whenToUse: 'Change a request entrypoint.' };

async function withGraph(metadata, capabilities, operation, extensions = {}) {
  const root = await createTemporaryDirectory('capability-graph-reference-');
  let graph;
  try {
    await writeFile(path.join(root, 'provider.json'), JSON.stringify(metadata), 'utf8');
    await writeFile(path.join(root, 'PROVIDER.md'), '# Provider rules\n', 'utf8');
    await mkdir(path.join(root, 'knowledge'));
    await writeFile(path.join(root, 'knowledge/routing.md'), '# Routing\n', 'utf8');
    for (const [index, record] of capabilities.entries()) {
      await writeFile(path.join(root, `${index}.capability.json`), JSON.stringify(record), 'utf8');
    }
    graph = await CapabilityGraph.open({
      hostAllowedProviders: [metadata.providerId], integrationEnabledProviders: [metadata.providerId],
      providers: [{ providerId: metadata.providerId, authority: { kind: 'file', rootDir: root } }],
      ...(typeof extensions === 'function' ? extensions(root) : extensions)
    });
    return await operation(graph.forProvider(metadata.providerId), graph);
  } finally {
    try { await graph?.close(); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
}

/** Exercise facts authored in reference pages through the public package, without internal validators. */
export async function verifyReferenceContracts(docsRoot) {
  const definition = await readFile(path.join(docsRoot, 'reference/provider-definition.mdx'), 'utf8');
  const knowledge = await readFile(path.join(docsRoot, 'reference/knowledge.mdx'), 'utf8');
  const meta = await readFile(path.join(docsRoot, 'reference/result-meta.mdx'), 'utf8');
  const budgetRows = rowsAfter(meta, '## 预算字段与默认值');
  const documentedBudgets = Object.fromEntries(budgetRows.map(([field, value]) => [field.replaceAll('`', ''), Number(value)]));
  const defaults = Object.fromEntries(Object.entries(DEFAULT_BUDGETS).flatMap(([group, fields]) =>
    Object.entries(fields).map(([field, value]) => [`${group}.${field}`, value])));
  assert.deepEqual(documentedBudgets, defaults, 'every budget field and default must match implementation');
  const queryPage = await readFile(path.join(docsRoot, 'reference/queries-and-results.mdx'), 'utf8');
  const detailDefault = queryPage.match(/neighborLimitPerKind 默认 (\d+)/)?.[1];
  assert.equal(Number(detailDefault), DEFAULT_BUDGETS.neighbors.defaultPageSize, 'detail neighbor default is not a separate constant');
  const idRows = rowsAfter(definition, '## ID 格式与值约束');
  assert.equal(idRows.length, 2);
  const samples = ['a', 'acme.http', 'route.validation', 'D-02', 'guide', 'Guide', '0route',
    'route validation', 'acme::route', ' 路由', 'route\n', '', 'a'.repeat(128), 'a'.repeat(129)];
  for (const [index, validate] of [isId, isKnowledgeId].entries()) {
    const expression = idRows[index][1].match(/^`(.+)`$/)?.[1];
    assert(expression, 'ID table must contain a complete regular expression');
    const pattern = new RegExp(expression);
    for (const value of samples) {
      assert.equal(pattern.test(value), validate(value), `documented ID format disagrees for ${JSON.stringify(value)}`);
    }
  }

  const ref = jsonFence(knowledge, 'document-ref.json');
  const documentRows = rowsAfter(knowledge, '### Document 字段');
  const collectionRows = rowsAfter(knowledge, '### Collection 字段');
  const declaration = ts.createSourceFile('types.d.ts',
    await readFile(new URL('../../../../dist/types.d.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  for (const [name, rows] of [['KnowledgeDocumentRef', documentRows], ['KnowledgeCollectionRef', collectionRows]]) {
    const contract = declaration.statements.find((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
    assert(contract, `missing public declaration: ${name}`);
    const fields = contract.members.map((member) => [member.name.getText(declaration), member.questionToken ? '否' : '是']);
    const documented = rows.map(([field, , required]) => [field.replaceAll('`', ''), required]);
    assert.deepEqual(documented.sort(), fields.sort(), `${name} documentation must cover every field and its optionality`);
  }
  const collection = { kind: 'collection', knowledgeId: 'routing-guides', members: [ref] };
  const accepts = (entry) => withGraph(provider, [{ ...capability, knowledge: [entry] }], () => {});
  let boundaryCases = 0;
  for (const [entry, rows] of [[ref, documentRows], [collection, collectionRows]]) {
    await accepts(entry);
    for (const [fieldCell, , required, constraint] of rows) {
      const field = fieldCell.replaceAll('`', '');
      if (required === '是') {
        const missing = { ...entry };
        delete missing[field];
        await assert.rejects(accepts(missing), { code: 'CG_VALIDATION_FAILED' }, `${entry.kind}.${field} must be required`);
        boundaryCases++;
      }
      await assert.rejects(accepts({ ...entry, [field]: null }), { code: 'CG_VALIDATION_FAILED' }, `${entry.kind}.${field} cannot be null`);
      const bytes = constraint.match(/最多 ([\d,]+) UTF-8 字节/);
      if (!bytes) continue;
      const maximum = Number(bytes[1].replaceAll(',', ''));
      const prefix = field === 'canonicalUrl' ? 'https://example.com/' : '';
      // Private-use locale subtags have 1–8 characters; fill valid subtags up to the documented byte boundary.
      const atLimit = field === 'locale'
        ? 'x-' + 'aaaaaaa-'.repeat(Math.floor((maximum - 3) / 8)) + 'a'.repeat((maximum - 3) % 8 + 1)
        : prefix + 'a'.repeat(maximum - prefix.length);
      await accepts({ ...entry, [field]: atLimit });
      await assert.rejects(accepts({ ...entry, [field]: `${atLimit}a` }), { code: 'CG_VALIDATION_FAILED' });
      if (['title', 'summary'].includes(field)) {
        const unicode = '路'.repeat(Math.floor(maximum / 3) + 1);
        assert(unicode.length < maximum && Buffer.byteLength(unicode) > maximum);
        await assert.rejects(accepts({ ...entry, [field]: unicode }), { code: 'CG_VALIDATION_FAILED' });
      }
      boundaryCases++;
    }
  }

  const specProvider = { ...provider, specification: { specificationId: 'acme.http.conventions', version: '1',
    documents: [{ kind: 'document', knowledgeId: 'SPEC-01', role: 'specification',
      locator: { type: 'relative-file', path: 'PROVIDER.md' } }] } };
  await withGraph(specProvider, [{ ...capability, knowledge: [ref, { ...ref, knowledgeId: 'routing-extra' }] }], async (bound) => {
    const specification = await bound.readSpecification({ knowledgeIds: ['missing', 'SPEC-01'] });
    const projected = specification.results.map((item) => item.ok
      ? { inputIndex: item.inputIndex, ok: true, knowledgeId: item.value.knowledgeId }
      : { inputIndex: item.inputIndex, ok: false, code: item.error.code, knowledgeId: item.error.details?.knowledgeId });
    assert.deepEqual(projected, jsonFence(meta, 'specification-slots.json'));

    const documents = await bound.readDocuments({ selected: ['route'] });
    assert.equal(documents.results.length, 2, 'one selected capability must expand to two document slots');
    assert(documents.results.every((item) => item.ok && item.value.id.capabilityId === 'route'));
    assert.deepEqual(documents.results.map((item) => item.value.knowledgeId).sort(), ['routing-extra', 'routing-guide']);
    const details = await bound.getCapabilities(['missing', 'route', 'route']);
    assert.deepEqual(details.results.map((item) => [item.inputIndex, item.ok]), [[0, false], [1, true], [2, true]]);

    const selectionRow = rowsAfter(meta, '## 预算与完整性').find(([operation]) => operation === 'Selection');
    assert(selectionRow, 'missing Selection budget row');
    const limits = [...selectionRow[1].matchAll(/[\d,]+/g)].map(([value]) => Number(value.replaceAll(',', '')));
    const selection = await bound.resolveSelection({ selected: ['route'] });
    assert.deepEqual(limits, ['maxSelected', 'maxNodes', 'maxEdges'].map((field) => selection.meta.budgets[`selection.${field}`]));
  });
  await withGraph(provider, [], async (bound) => {
    const catalog = await bound.listCatalog();
    assert.deepEqual(catalog.items, []);
    assert.equal(catalog.meta.completeness, 'complete');
    assert.equal(catalog.nextCursor, undefined);
  });

  const migration = await readFile(path.join(docsRoot, 'getting-started/installation.mdx'), 'utf8');
  const old = jsonFence(migration, 'migration-old-specification.json');
  const migrated = jsonFence(migration, 'migration-new-specification.json');
  await assert.rejects(withGraph({ ...provider, ...old }, [capability], () => {}), { code: 'CG_VALIDATION_FAILED' });
  await withGraph({ ...provider, ...migrated }, [capability], async (bound) => {
    assert.equal((await bound.getProvider()).specification.documentCount, 1);
    assert.equal((await bound.readSpecification()).results[0].ok, true);
  });

  const many = [capability, ...Array.from({ length: 105 }, (_, index) => ({ ...capability,
    capabilityId: `child-${String(index).padStart(3, '0')}`, parents: ['route'] }))];
  await withGraph(provider, many, async (bound) => {
    assert.equal((await bound.listCatalog({ limit: 99999 })).meta.filter.limit, defaults['catalog.maxItems']);
    const detail = await bound.getCapabilities(['route']);
    assert(detail.results[0].ok);
    assert.equal(detail.results[0].value.neighborSummaries.children.items.length, Number(detailDefault));
    assert.equal((await bound.getNeighbors('route')).groups.children.items.length, defaults['neighbors.defaultPageSize']);
    assert.equal((await bound.getNeighbors('route', { limitPerKind: 99999 })).groups.children.items.length, defaults['neighbors.maxPageSize']);
    const zero = await bound.getCapabilities(['route'], { neighborLimitPerKind: 0 });
    assert(zero.results[0].ok);
    assert.equal(zero.results[0].value.neighborSummaries.children.items.length, 0);
    for (const value of [0, -1, 1.5, null, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(bound.listCatalog({ limit: value }), { code: 'CG_INPUT_INVALID' });
    }
  }, { budgets: { neighbors: { maxBytes: 1048576 } } }); // isolate the count cap from the shared page-byte cap
  for (const budgets of [{ runtime: { timeoutMs: 0 } }, { unknown: {} },
    { runtime: { defaultPageSize: 101 } }, { read: { maxBytes: null } }]) {
    await assert.rejects(withGraph(provider, [], () => {}, { budgets }), { code: 'CG_CONFIG_INCOMPLETE' });
  }

  let response;
  const inputs = [];
  const validObservation = { source: 'contract', observedAt: '2026-10-09T00:00:00Z', runtimeRevision: 'r1',
    observedAgainstStaticRevision: 's1', compatibility: 'unknown', availability: 'empty', freshness: 'current' };
  const runtime = { id: 'reference-contract', providerId: provider.providerId, query: async (input) => {
    inputs.push(input); return response;
  } };
  await withGraph(provider, [capability], async (bound) => {
    response = { instances: [], observation: validObservation };
    assert.equal((await bound.queryRuntime({ project: 'demo', environment: 'test' })).items.length, 0);
    assert.equal(inputs.at(-1).limit, defaults['runtime.defaultPageSize']);
    await bound.queryRuntime({ project: 'demo', environment: 'test', limit: 99999 });
    assert.equal(inputs.at(-1).limit, defaults['runtime.maxPageSize']);
    for (const field of Object.keys(validObservation)) {
      response = { instances: [], observation: { ...validObservation } };
      delete response.observation[field];
      await assert.rejects(bound.queryRuntime({ project: 'demo', environment: 'test' }), { code: 'CG_ADAPTER_CONTRACT_INVALID' }, `${field} is mandatory`);
    }
    for (const [field, value] of [['compatibility', 'compatible-ish'], ['availability', 'offline'], ['freshness', 'unknown'], ['observedAt', 'yesterday']]) {
      response = { instances: [], observation: { ...validObservation, [field]: value } };
      await assert.rejects(bound.queryRuntime({ project: 'demo', environment: 'test' }), { code: 'CG_ADAPTER_CONTRACT_INVALID' });
    }
    response = { instances: [], observation: { ...validObservation, availability: 'available' } };
    await assert.rejects(bound.queryRuntime({ project: 'demo', environment: 'test' }), { code: 'CG_ADAPTER_CONTRACT_INVALID' });
    for (const query of [{ project: 'demo' }, { environment: 'test' }, { project: ' ', environment: 'test' }]) {
      await assert.rejects(async () => bound.queryRuntime(query), { code: 'CG_RUNTIME_CONTEXT_REQUIRED' });
    }
    response = { instances: [], observation: validObservation };
    await assert.rejects(bound.queryRuntime({ project: 'demo', environment: 'test', requiredRuntimeRevision: 'r2' }), { code: 'CG_REVISION_MISMATCH' });
    await assert.rejects(async () => bound.listCatalog({ requestProviderScope: [provider.providerId] }), { code: 'CG_INPUT_INVALID' });
  }, { runtimeAdapters: [runtime] });

  let offline = false;
  const databaseRecord = { ...capability, capabilityId: 'query' };
  const view = { provider: { providerId: 'acme.database', name: 'Database contract double', version: '1' },
    sourceRevision: 'db:1', getCapability: async (id) => {
      if (offline) throw new Error('injected unreadable source');
      return id === 'query' ? databaseRecord : undefined;
    }, scanCapabilities: async () => ({ items: [databaseRecord] }), neighbors: async () => ({ items: [] }), close: async () => {} };
  await withGraph(provider, [{ ...capability, knowledge: [ref] }], async (bound, graph) => {
    const revision = (await graph.getProvider('acme.database')).staticRevision;
    offline = true;
    const local = { providerId: provider.providerId, capabilityId: 'route' };
    const remote = { providerId: 'acme.database', capabilityId: 'query' };
    for (const batch of [await graph.getCapabilities([local, remote]), await graph.readDocuments({ selected: [local, remote] })]) {
      assert.deepEqual(batch.results.map((item) => item.ok ? 'ok' : item.error.code), ['ok', 'CG_NO_ACTIVE_VIEW']);
      assert.equal(batch.meta.completeness, 'partial');
    }
    await assert.rejects(graph.listCatalog(), { code: 'CG_NO_ACTIVE_VIEW' });
    await assert.rejects(graph.listProviders(), { code: 'CG_NO_ACTIVE_VIEW' });
    await assert.rejects(graph.getCapabilities([remote], { requiredStaticRevision: revision }), { code: 'CG_REVISION_MISMATCH' });
    await assert.rejects(graph.queryRuntime({ project: 'demo', environment: 'test' }), { code: 'CG_INPUT_INVALID' });
  }, (root) => ({ hostAllowedProviders: [provider.providerId, 'acme.database'], integrationEnabledProviders: [provider.providerId, 'acme.database'],
    providers: [{ providerId: provider.providerId, authority: { kind: 'file', rootDir: root } },
      { providerId: 'acme.database', authority: { kind: 'database', adapter: { id: 'reference-double', openView: async () => view } } }] }));

  for (const page of ['concepts/provider-scope.mdx', 'guides/multiple-providers.mdx', 'examples/multi-provider.mdx']) {
    const authored = await readFile(path.join(docsRoot, page), 'utf8');
    assert(!authored.includes('批量查询保留输入槽位'), `${page}: do not generalize input-slot alignment to document reads`);
    assert(/listCatalog/.test(authored) && /(?:查询级失败|整体失败|整次失败|联合目录则明确失败)/.test(authored), `${page}: explain joint catalog failure explicitly`);
  }
  console.log(`reference contracts passed: ID/${boundaryCases} field boundaries, ${budgetRows.length} budget defaults, paging clamps, Runtime values, migration, batch/Selection/scope semantics`);
}
