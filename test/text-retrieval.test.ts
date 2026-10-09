import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CapabilityGraph, type KnowledgeRetriever, type SourceChange } from '@devcodex/capability-graph';
import { TextCapabilityRetriever, TextKnowledgeRetriever } from '../examples/seed-runtime/text-retrieval.js';

const helper = pathToFileURL(path.resolve(import.meta.dirname, '../../scripts/lib/website-paths.mjs'));

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
