import { createTemporaryDirectory } from '../../../lib/artifact-paths.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CapabilityGraph } from '../../../../dist/index.js';

/** Execute the page's factory, including an upstream stream that emits no chunks. */
export async function verifyDocumentedReaderFactory(createHttpReader, Graph = CapabilityGraph) {
  const root = await createTemporaryDirectory('cg-reader-factory-');
  const url = 'https://example.invalid/factory';
  let bytes = Buffer.alloc(0);
  let graph;
  try {
    await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'acme.reader', name: 'Reader', version: '1' }));
    await mkdir(path.join(root, 'capabilities'));
    await writeFile(path.join(root, 'capabilities/read.json'), JSON.stringify({
      capabilityId: 'read', name: 'Read', description: 'Factory verification', whenToUse: 'Read the source',
      knowledge: [{ kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url } }]
    }));
    const reader = createHttpReader(async () => bytes, async function* (_url, { chunkBytes }) {
      for (let start = 0; start < bytes.length; start += chunkBytes) yield bytes.subarray(start, start + chunkBytes);
    });
    graph = await Graph.open({ hostAllowedProviders: ['acme.reader'], integrationEnabledProviders: ['acme.reader'],
      providers: [{ providerId: 'acme.reader', authority: { kind: 'file', definitionLayout: 'directory', rootDir: root } }], readers: [reader] });
    const provider = graph.forProvider('acme.reader');
    for (const size of [0, 32768, 32769]) {
      bytes = Buffer.alloc(size, 97);
      const full = (await provider.readDocuments({ selected: ['read'] })).results[0];
      assert(full, 'documented Reader factory returned no result');
      if (size <= 32768) {
        assert(full.ok, 'documented Reader factory rejected a within-budget body');
        assert.equal(full.value.text, bytes.toString());
      } else {
        assert.equal(full.ok, false, 'documented Reader factory must reject an oversized full read');
        assert.equal(full.error.code, 'CG_BUDGET_EXCEEDED', 'documented Reader factory lost the budget error');
        assert.equal(full.error.nextAction, 'page_or_filter');
      }
      let cursor;
      let offset = 0;
      const parts = [];
      do {
        let page;
        try { page = await provider.readDocumentPage({ capabilityId: 'read', knowledgeId: 'guide',
          maxBytes: cursor ? 2048 : 1024, ...(cursor ? { cursor } : {}) }); }
        catch (error) { assert.fail(`documented Reader factory failed to page ${size} bytes: ${error.code}`); }
        assert.equal(page.source, url); assert.equal(page.contentType, 'text/plain; charset=utf-8');
        assert.equal(page.contentId, `k:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`);
        assert.equal(page.startOffset, offset); offset = page.endOffset;
        parts.push(page.text); cursor = page.nextCursor;
        assert.equal(page.hasMore, cursor !== undefined);
      } while (cursor);
      assert.equal(offset, size); assert.equal(parts.join(''), bytes.toString(), 'documented Reader factory changed the body');
    }
  } finally {
    try { await graph?.close(); } finally { await rm(root, { recursive: true }); }
  }
}

function readerAlgorithm(source) {
  const expression = source.match(/createHash\('([^']+)'\)\.update\(bytes\)\.digest\('([^']+)'\)\.slice\(0,\s*(\d+)\)/);
  assert(expression, 'Reader documentation must include the precise bytes-to-contentId expression');
  const [, algorithm, encoding, length] = expression;
  assert.equal(encoding, 'hex');
  return { expression: expression[0].replace(/\s+/g, ''), contentId: (bytes) =>
    `k:${createHash(algorithm).update(bytes).digest(encoding).slice(0, Number(length))}` };
}

function retrievalOutcomes(source) {
  const table = source.slice(source.indexOf('| 场景 |')).match(/(?:^\|[^\n]+\n)+/m)?.[0];
  assert(table, 'knowledge retrieval failure table is missing');
  return new Map(table.trim().split('\n').slice(2).map((line) => {
    const [, scenario, outcome] = line.split('|').map((cell) => cell.trim());
    const value = outcome.match(/`([^`]+)`/)?.[1];
    assert(value, `${scenario}: missing documented outcome`);
    return [scenario, value];
  }));
}

/** Read the documented algorithm/outcomes, then exercise the public API. */
export async function verifyAdapterContracts(docsRoot) {
  const adapterPage = await readFile(path.join(docsRoot, 'reference/runtime-adapter.mdx'), 'utf8');
  const readerPage = await readFile(path.join(docsRoot, 'integrations/knowledge-reader.mdx'), 'utf8');
  const troubleshooting = await readFile(path.join(docsRoot, 'troubleshooting/knowledge-read.mdx'), 'utf8');
  const documented = readerAlgorithm(adapterPage);
  assert.equal(documented.expression, readerAlgorithm(readerPage).expression, 'Reader algorithm differs between reference and integration');
  const outcomes = retrievalOutcomes(adapterPage);
  assert.deepEqual(outcomes, retrievalOutcomes(troubleshooting), 'knowledge error outcomes differ between reference and troubleshooting');
  const outcome = (scenario) => {
    assert(outcomes.has(scenario), `missing retrieval scenario: ${scenario}`);
    return outcomes.get(scenario);
  };

  const root = await createTemporaryDirectory('cg-adapter-contracts-');
  const bytes = Buffer.from('审查正文\n', 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const correctId = `k:${digest.slice(0, 16)}`;
  let readerId = documented.contentId(bytes);
  let mode = 'valid';
  let invocations = 0;
  let graph;
  try {
    await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'acme.audit', name: 'Audit', version: '1' }));
    await mkdir(path.join(root, 'capabilities'));
    await writeFile(path.join(root, 'capabilities/route.json'), JSON.stringify({
      capabilityId: 'route', name: 'Route', description: 'Adapter contract', whenToUse: 'Audit',
      knowledge: [{ kind: 'document', knowledgeId: 'guide', role: 'guide', locator: { type: 'http', url: 'https://example.invalid/guide' } }]
    }));
    graph = await CapabilityGraph.open({
      hostAllowedProviders: ['acme.audit'], integrationEnabledProviders: ['acme.audit'],
      providers: [{ providerId: 'acme.audit', authority: { kind: 'file', definitionLayout: 'directory', rootDir: root } }],
      readers: [{ id: 'audit-reader', canRead: () => true, async read(ref) {
        return { bytes, contentType: 'text/plain', source: ref.locator.url, contentId: readerId };
      } }],
      knowledgeRetriever: { id: 'audit-retriever', async retrieve(input) {
        invocations++;
        const evidence = { staticRevisionByProvider: input.staticRevisionByProvider, mappingRevision: input.mappingRevision,
          sourceConfigRevision: 'config', indexedConfigRevision: 'config', observedAt: new Date().toISOString(), freshness: 'current',
          documents: input.targets.map((target) => ({ id: target.id, knowledgeId: target.knowledgeId,
            sourceContentId: correctId, indexedContentId: correctId })) };
        const target = input.targets[0];
        const validHit = { id: target.id, knowledgeId: target.knowledgeId, contentId: correctId, source: target.locator.url,
          startOffset: 0, endOffset: bytes.byteLength, snippet: bytes.toString('utf8') };
        switch (mode) {
          case 'static': evidence.staticRevisionByProvider = { 'acme.audit': 'outdated' }; break;
          case 'documents': evidence.documents = null; break;
          case 'mapping': evidence.mappingRevision = 'old'; break;
          case 'config': evidence.indexedConfigRevision = 'old'; break;
          case 'content': evidence.documents[0].indexedContentId = 'k:0000000000000000'; break;
          case 'freshness': evidence.freshness = 'stale'; break;
        }
        return { hits: mode === 'page' ? null : mode === 'hit'
          ? [validHit, { ...validHit, endOffset: bytes.byteLength + 1 }] : [],
        ...(mode === 'missing' ? {} : { evidence }) };
      } },
      budgets: { runtime: { timeoutMs: 5 } },
      runtimeAdapters: [{ id: 'audit-runtime', providerId: 'acme.audit', async query() {
        await new Promise((resolve) => setTimeout(resolve, 30)); throw new Error('late rejection');
      } }]
    });
    const bound = graph.forProvider('acme.audit');
    const successfulRead = await bound.readDocuments({ selected: ['route'] });
    assert.equal(successfulRead.results[0].ok, true, 'documented Reader algorithm rejected by Core');
    assert.equal(successfulRead.results[0].value.contentId, readerId);
    readerId = `k:${digest}`;
    const rejectedRead = await bound.readDocuments({ selected: ['route'] });
    assert.equal(rejectedRead.results[0].ok, false);
    assert.equal(rejectedRead.results[0].error.code, 'CG_ADAPTER_CONTRACT_INVALID');
    assert.equal(rejectedRead.results[0].error.details.reason, 'reader_content_identity_mismatch');
    readerId = documented.contentId(bytes);
    const input = { text: 'route', selected: [{ capabilityId: 'route' }] };
    const empty = await bound.queryKnowledge(input);
    assert.equal(empty.knowledgeState, outcome('有效证据、零命中'));
    assert.deepEqual(empty.items, []);
    assert(empty.indexStatus);
    for (const [caseMode, scenario] of [
      ['static', 'Static Revision 证据不匹配'], ['documents', '索引证据无效或过期'], ['missing', '索引证据无效或过期'],
      ['mapping', '索引证据无效或过期'], ['config', '索引证据无效或过期'], ['content', '索引证据无效或过期'],
      ['freshness', '索引证据无效或过期'], ['page', '原始检索页违反合同']
    ]) {
      mode = caseMode;
      await assert.rejects(bound.queryKnowledge(input), { code: outcome(scenario),
        ...(caseMode === 'page' ? {} : { nextAction: 'refresh' }) }, `${scenario}: documented knowledge error differs from Core`);
    }
    mode = 'hit';
    const partial = await bound.queryKnowledge(input);
    assert.equal(partial.items.length, 1);
    assert.equal(partial.meta.completeness, 'partial');
    assert.equal(partial.meta.warnings[0].code, outcome('单项命中违反合同'));
    const before = invocations;
    assert.equal((await bound.queryKnowledge({ ...input, roles: ['unmatched'] })).knowledgeState, 'filtered_empty');
    assert.equal(invocations, before, 'filtered-empty targets must not call Retriever');
    const unhandled = [];
    const record = (error) => unhandled.push(error);
    process.on('unhandledRejection', record);
    try {
      await assert.rejects(bound.queryRuntime({ project: 'audit', environment: 'test' }), { code: 'CG_RUNTIME_UNAVAILABLE' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(unhandled, [], 'Core must handle late rejection of the returned query Promise');
    } finally { process.off('unhandledRejection', record); }
    const factory = readerPage.match(/```ts title="reader-skeleton\.ts"\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert(factory, 'HTTP Reader implementation fence is missing');
    const module = path.join(root, 'reader-factory.mjs');
    const compiled = ts.transpileModule(factory, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    // These contract checks use this build; the consumer gate separately leaves the public import intact.
    const core = new URL('../../../../dist/index.js', import.meta.url).href;
    await writeFile(module, compiled.replaceAll("'@devcodex/capability-graph'", JSON.stringify(core)));
    await verifyDocumentedReaderFactory((await import(pathToFileURL(module).href)).createHttpReader);
    console.log('Adapter contracts passed: 14 Reader/retrieval/Runtime cases and actual page factory empty/boundary/oversized bodies');
  } finally {
    try { await graph?.close(); }
    finally { await rm(root, { recursive: true }); }
  }
}
