import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CapabilityGraph, type KnowledgeRetriever, type SourceChange } from '@devcodex/capability-graph';
import { TextCapabilityRetriever, TextKnowledgeRetriever } from '../examples/seed-runtime/text-retrieval.js';

const helper = pathToFileURL(path.resolve(import.meta.dirname, '../../scripts/lib/artifact-paths.mjs'));

async function sources() {
  const { createTemporaryDirectory } = await import(helper.href);
  const root: string = await createTemporaryDirectory('text-index-');
  try {
    const first = path.join(root, 'first');
    await mkdir(first);
    await writeFile(path.join(first, 'provider.json'), JSON.stringify({ providerId: 'alpha', name: 'Alpha', version: '1' }));
    for (const id of ['a', 'b', 'c']) {
      await writeFile(path.join(first, `${id}.capability.json`), JSON.stringify({
        capabilityId: id, name: `${id} validation`, description: 'Request validation', whenToUse: 'Validate requests',
        knowledge: [{ kind: 'document', knowledgeId: `GUIDE-${id}`, role: 'guide', locator: { type: 'relative-file', path: `${id}.md` } }],
      }));
      await writeFile(path.join(first, `${id}.md`), `${id} validation 正文\n`);
    }
    const second = path.join(root, 'second');
    await cp(first, second, { recursive: true });
    return { root, first, second, close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

const config = (root: string) => ({ hostAllowedProviders: ['alpha'], integrationEnabledProviders: ['alpha'],
  providers: [{ providerId: 'alpha', authority: { kind: 'file' as const, rootDir: root } }] });
const query = (capabilityId: string, text = 'validation') => ({ selected: [{ capabilityId }], knowledgeIds: [`GUIDE-${capabilityId}`], text });
const change = (providerId: string, staticRevision: string, reason: SourceChange['reason']): SourceChange => ({ providerId, staticRevision, reason });

test('capability recall uses Chinese phrases, rejects unknown requests and separates explicit negation', async () => {
  const source = await sources(); let graph: CapabilityGraph | undefined;
  try {
    for (const [id, name, description, whenToUse] of [
      ['a', '响应缓存', '缓存 HTTP 接口响应', '设置缓存 ttl'],
      ['b', '数据库', '数据库访问与持久化', '使用 MonSQLize Models CRUD'],
      ['c', '参数校验', '请求响应数据契约', '校验请求 schema'],
    ]) await writeFile(path.join(source.first, `${id}.capability.json`), JSON.stringify({ capabilityId: id, name, description, whenToUse }));
    const recall = new TextCapabilityRetriever();
    graph = await CapabilityGraph.open({ ...config(source.first), capabilityRetriever: recall });
    await recall.rebuild(graph);
    assert.equal((await graph.retrieveCapabilities({ text: '没有匹配能力的量子传送器' })).items.length, 0);
    assert.deepEqual((await graph.retrieveCapabilities({ text: '不要数据库，只需要响应缓存' })).items.map((item) => item.id.capabilityId), ['a']);
    assert.equal((await graph.retrieveCapabilities({ text: '校验请求 schema' })).items[0]?.id.capabilityId, 'c');
  } finally { await graph?.close(); await source.close(); }
});

test('in-flight queries keep one configuration and unrelated invalidation preserves publication', async () => {
  for (const reconfigure of [false, true]) {
    const source = await sources();
    const retriever = new TextKnowledgeRetriever();
    let captured!: () => void, captureFailed!: (error: unknown) => void, release!: () => void;
    const ready = new Promise<void>((resolve, reject) => { captured = resolve; captureFailed = reject; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0, graph: CapabilityGraph | undefined, pending: Promise<unknown> | undefined;
    const wrapper: KnowledgeRetriever = { id: retriever.id, retrieve: (input, access) => retriever.retrieve(input, {
      read: async (...args) => {
        try {
          const body = await access.read(...args);
          if (++reads === 1) { captured(); await resume; }
          return body;
        } catch (error) { captureFailed(error); throw error; }
      },
    }) };
    try {
      graph = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: wrapper });
      const provider = graph.forProvider('alpha');
      const revision = (await provider.getProvider()).staticRevision;
      const input = { selected: [{ capabilityId: 'a' }, { capabilityId: 'b' }], text: 'validation' };
      const older = provider.queryKnowledge(input);
      pending = older; older.catch(captureFailed);
      await ready;
      await retriever.invalidate(change('unrelated', revision, 'knowledge_body'));
      if (reconfigure) retriever.configure({ chunkBytes: 4, maxDocumentBytes: 1, stopWords: ['validation'] });
      release();
      assert((await older).items.length > 0, 'all body limits, chunks and query terms use the invocation snapshot');
      assert.equal(retriever.cachedSelections, reconfigure ? 0 : 1);
      if (reconfigure) {
        await assert.rejects(provider.queryKnowledge(input), { code: 'CG_BUDGET_EXCEEDED' });
        retriever.configure({ maxDocumentBytes: 32768 });
        assert.equal((await provider.queryKnowledge(input)).items.length, 0, 'new query uses the new stop words');
      }
    } finally {
      release(); await Promise.allSettled(pending ? [pending] : []);
      await graph?.close(); await source.close();
    }
  }
});

test('real file indexes enforce LRU capacity and scoped invalidation without hiding read failures', async () => {
  const source = await sources();
  const retriever = new TextKnowledgeRetriever(2);
  let graph: CapabilityGraph | undefined;
  try {
    graph = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: retriever });
    const provider = graph.forProvider('alpha');
    const revision = (await provider.getProvider()).staticRevision;
    assert((await provider.queryKnowledge(query('a'))).items.length > 0);
    assert((await provider.queryKnowledge(query('b'))).items.length > 0);
    await provider.queryKnowledge(query('a')); // Touch a so b is the least recently used selection.
    await provider.queryKnowledge(query('c'));
    assert.equal(retriever.cachedSelections, 2);
    await writeFile(path.join(source.first, 'b.md'), 'rebuilt 正文\n');
    assert((await provider.queryKnowledge(query('b', 'rebuilt'))).items.length > 0,
      'evicted selection must build from current bytes');
    await retriever.invalidate(change('unrelated', 's:unrelated', 'knowledge_body'));
    assert.equal(retriever.cachedSelections, 2, 'unrelated provider must keep its cache entries');
    await rm(path.join(source.first, 'b.md'));
    await assert.rejects(provider.queryKnowledge(query('b')), { code: 'CG_SOURCE_UNREADABLE' });
    await writeFile(path.join(source.first, 'b.md'), 'rebuilt 正文\n');
    assert((await provider.queryKnowledge(query('b', 'rebuilt'))).items.length > 0);
    await retriever.invalidate(change('alpha', revision, 'knowledge_body'));
    assert.equal(retriever.cachedSelections, 0);
  } finally {
    await graph?.close(); await source.close();
    await assert.rejects(readFile(path.join(source.first, 'provider.json')), { code: 'ENOENT' });
  }
});

test('identical static revisions and bytes from a different root still require mapping invalidation', async () => {
  const source = await sources();
  const retriever = new TextKnowledgeRetriever();
  let first: CapabilityGraph | undefined;
  let second: CapabilityGraph | undefined;
  try {
    first = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: retriever });
    const original = await first.forProvider('alpha').queryKnowledge(query('a'));
    second = await CapabilityGraph.open({ ...config(source.second), knowledgeRetriever: retriever });
    const bound = second.forProvider('alpha');
    const revision = (await bound.getProvider()).staticRevision;
    assert.equal(revision, (await first.getProvider('alpha')).staticRevision);
    await assert.rejects(bound.queryKnowledge(query('a')), { code: 'CG_INDEX_STALE' });
    await assert.rejects(bound.queryKnowledge(query('a', 'absentxyz')), { code: 'CG_INDEX_STALE' });
    await retriever.invalidate(change('alpha', revision, 'knowledge_mapping'));
    const rebuilt = await bound.queryKnowledge(query('a'));
    assert.equal(rebuilt.meta.completeness, 'complete');
    assert(rebuilt.items.length > 0);
    assert.notEqual(rebuilt.indexStatus?.mappingRevision, original.indexStatus?.mappingRevision);
  } finally { await first?.close(); await second?.close(); await source.close(); }
});

test('capability index rebuild is atomic when a real Catalog exceeds configured capacity', async () => {
  const source = await sources();
  const retriever = new TextCapabilityRetriever(2);
  let graph: CapabilityGraph | undefined;
  try {
    await rm(path.join(source.first, 'c.capability.json'));
    graph = await CapabilityGraph.open({ ...config(source.first), capabilityRetriever: retriever });
    const bound = graph.forProvider('alpha');
    const oldRevision = (await bound.getProvider()).staticRevision;
    await retriever.rebuild(graph);
    assert.equal((await bound.retrieveCapabilities({ text: 'validation' })).items.length, 2);
    await cp(path.join(source.second, 'c.capability.json'), path.join(source.first, 'c.capability.json'));
    assert((await graph.reload({ providerId: 'alpha' })).ok);
    await assert.rejects(retriever.rebuild(graph), { code: 'CG_BUDGET_EXCEEDED' });
    await assert.rejects(bound.retrieveCapabilities({ text: 'validation' }), { code: 'CG_INDEX_STALE' });
    const retained = await bound.retrieveCapabilities({ text: 'validation', requiredStaticRevision: oldRevision });
    assert.equal(retained.items.length, 2, 'failed rebuild must retain the earlier complete index');
    await rm(path.join(source.first, 'c.capability.json'));
    assert((await graph.reload({ providerId: 'alpha' })).ok);
    await retriever.rebuild(graph);
    assert.equal((await bound.retrieveCapabilities({ text: 'validation' })).items.length, 2);
  } finally { await graph?.close(); await source.close(); }
});

test('oversized indexes use streaming Top-K with exact ranking, offsets and hashes without retaining the body', async () => {
  const source = await sources();
  const bounded = new TextKnowledgeRetriever(); bounded.configure({ maxCachedBytes: 4096, maxCachedEntries: 16, chunkBytes: 64 });
  const baseline = new TextKnowledgeRetriever(); baseline.configure({ maxCachedBytes: 16_777_216, maxCachedEntries: 100000, chunkBytes: 64 });
  const body = 'validation 中文🙂\n'.repeat(12000) + 'validation exactneedle 中文🙂\n';
  await writeFile(path.join(source.first, 'a.md'), body); await writeFile(path.join(source.first, 'b.md'), body);
  let first: CapabilityGraph | undefined; let second: CapabilityGraph | undefined;
  try {
    first = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: bounded });
    second = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: baseline });
    const input = { selected: [{ capabilityId: 'a' }, { capabilityId: 'b' }], text: 'validation exactneedle', limit: 3 };
    const actual = await first.forProvider('alpha').queryKnowledge(input); const expected = await second.forProvider('alpha').queryKnowledge(input);
    assert.deepEqual(actual.items, expected.items); assert(actual.items.some((hit) => hit.snippet.includes('exactneedle')));
    assert.equal(actual.meta.completeness, 'complete'); assert.equal(bounded.cachedSelections, 0); assert.equal(bounded.cachedBytes, 0); assert.equal(bounded.cachedEntries, 0);
    assert.deepEqual((await first.forProvider('alpha').queryKnowledge(input)).items, actual.items);
    assert((await first.forProvider('alpha').queryKnowledge(query('c'))).items.length > 0);
    assert(bounded.cachedBytes <= 4096 && bounded.cachedEntries <= 16);
  } finally { await first?.close(); await second?.close(); await source.close(); }
});

test('UTF-8 line streaming preserves ranked byte ranges and caches only searchable chunks', async () => {
  const source = await sources();
  const body = Buffer.from('\ufeff\r\n\r\n---\r\nskip\r\nvalidation🙂\r\n中文🙂\r\nabcdefghijklmnopqrst\r\nvalidation 中文\r\n');
  await writeFile(path.join(source.first, 'a.md'), body);
  const snippets = ['中文🙂\r\n', 'validation 中', 'validation🙂\r\n', '文\r\n'];
  const expected = snippets.map((snippet, index) => ({ snippet, score: index < 2 ? 2 : 1,
    startOffset: body.indexOf(Buffer.from(snippet)), endOffset: body.indexOf(Buffer.from(snippet)) + Buffer.byteLength(snippet),
    contentId: `k:${createHash('sha256').update(body).digest('hex').slice(0, 16)}` }));
  try {
    for (const pageBytes of [5, 7, 32768]) for (const scanning of [true, false]) {
      if (!scanning && pageBytes !== 32768) continue; // Legacy read-only access returns the complete document.
      const retriever = new TextKnowledgeRetriever();
      retriever.configure({ chunkBytes: 16, pageBytes, stopWords: ['skip'], maxCachedEntries: 6 });
      const adapter: KnowledgeRetriever = { id: retriever.id,
        retrieve: (input, access) => retriever.retrieve(input, scanning ? access : { read: access.read }) };
      const graph = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: adapter });
      try {
        const bound = graph.forProvider('alpha');
        const input = { ...query('a', 'validation中文'), limit: 8 };
        for (let invocation = 0; invocation < 2; invocation++) {
          const page = await bound.queryKnowledge(input);
          assert.equal(page.meta.completeness, 'complete');
          assert.deepEqual(page.items.map(({ snippet, score, startOffset, endOffset, contentId }) =>
            ({ snippet, score, startOffset, endOffset, contentId })), expected);
          assert.equal(retriever.cachedSelections, 1);
          assert.equal(retriever.cachedEntries, 6, 'blank, punctuation-only and stopped chunks cannot consume the cache budget');
        }
        assert.equal((await bound.queryKnowledge(query('a', 'skip'))).items.length, 0);
        await writeFile(path.join(source.first, 'a.md'), Buffer.from(body.toString().replace('中文🙂', '中文😎')));
        await assert.rejects(bound.queryKnowledge(input), { code: 'CG_INDEX_STALE' });
        await retriever.invalidate(change('alpha', (await bound.getProvider()).staticRevision, 'knowledge_body'));
        assert((await bound.queryKnowledge(input)).items.some((hit) => hit.snippet === '中文😎\r\n'));
      } finally { await graph.close(); await writeFile(path.join(source.first, 'a.md'), body); }
    }
  } finally { await source.close(); }
});

test('aborted line scans cannot publish partial indexes and later queries recover', async () => {
  const source = await sources();
  await writeFile(path.join(source.first, 'a.md'), 'validation 中文🙂\r\n'.repeat(2000));
  const retriever = new TextKnowledgeRetriever(); retriever.configure({ pageBytes: 7 });
  let abort = true;
  const adapter: KnowledgeRetriever = { id: retriever.id, retrieve: (input, access) => {
    const controller = new AbortController();
    return retriever.retrieve(input, { read: access.read, scan: (target, consume, options) => access.scan!(target, async (bytes, offset) => {
      await consume(bytes, offset); if (abort) controller.abort();
    }, { ...options, signal: controller.signal }) });
  } };
  let graph: CapabilityGraph | undefined;
  try {
    graph = await CapabilityGraph.open({ ...config(source.first), knowledgeRetriever: adapter });
    const bound = graph.forProvider('alpha');
    await assert.rejects(bound.queryKnowledge(query('a')), { code: 'CG_SOURCE_UNREADABLE' });
    assert.equal(retriever.cachedSelections, 0); assert.equal(retriever.cachedBytes, 0); assert.equal(retriever.cachedEntries, 0);
    abort = false;
    const recovered = await bound.queryKnowledge(query('a'));
    assert.equal(recovered.meta.completeness, 'complete'); assert(recovered.items.length > 0);
    assert.equal(retriever.cachedSelections, 1);
  } finally { await graph?.close(); await source.close(); }
});
