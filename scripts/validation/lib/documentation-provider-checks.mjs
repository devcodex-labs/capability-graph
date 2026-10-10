import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../../examples/vextjs/source-provenance.mjs';
import { assertKnowledgeEvidence } from './retrieval-assertions.mjs';

/** Inspect the exported layout, every original chapter and actual Core pages, with independent task expectations. */
export async function verifyDocumentationProvider({ graph, recall, exported, sourceRoot }) {
  async function files(directory) {
    const found = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...await files(file)); else found.push(file);
    }
    return found;
  }
  const knowledgeFiles = await files(path.join(exported.rootDir, 'knowledge'));
  assert.equal(knowledgeFiles.length, exported.documentCount);
  assert(knowledgeFiles.every((file) => /\.mdx?$/.test(file)), 'Knowledge must contain official Markdown/MDX only');
  const definitions = await files(path.join(exported.rootDir, 'capabilities'));
  assert.equal(definitions.length, exported.count);
  for (const file of definitions) {
    const record = JSON.parse(await readFile(file, 'utf8'));
    assert(!record.capabilityId.startsWith('native.') && !['business.notes', 'local-drift'].includes(record.capabilityId));
    assert.equal(record.requires, undefined, 'Document associations must not invent necessary dependencies');
    assert(record.knowledge.length > 0);
  }
  const results = []; const bound = graph.forProvider('vextjs');
  for (const document of exported.manifest.documents) {
    const original = await readFile(path.join(sourceRoot, document.originalPath));
    const copy = await readFile(path.join(exported.rootDir, document.exportedPath));
    assert.deepEqual(copy, original); assert.equal(sha256(original), document.sha256);
    assert.equal(document.exportedSha256, document.sha256);
    let cursor; let pages = 0; const chunks = []; let offset = 0;
    const capabilityId = document.capabilityIds[0];
    if (capabilityId) {
      do {
        const page = await bound.readDocumentPage({ capabilityId, knowledgeId: document.knowledgeId, ...(cursor ? { cursor } : {}) });
        assert.equal(page.startOffset, offset); assert.equal(page.totalBytes, original.length);
        assert.deepEqual(Buffer.from(page.text), original.subarray(page.startOffset, page.endOffset));
        assert.equal(page.contentId, `k:${sha256(original).slice(0, 16)}`);
        chunks.push(Buffer.from(page.text)); offset = page.endOffset; pages++; cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(Buffer.concat(chunks), original);
    } else {
      assert.equal(document.classification, 'reference-only'); assert(document.referenceReason);
    }
    results.push({ chapter: document.chapter, classification: document.classification, capabilityIds: document.capabilityIds,
      bytes: original.length, sha256: document.sha256, byteExactCopy: true, pages,
      readVerification: capabilityId ? 'Core pages reconstruct original bytes' : 'reference-only; original/copy hash verified; no task query',
      frameworkBehavior: 'not-established-by-document-reading' });
  }
  await recall.rebuild(graph);
  const tasks = JSON.parse(await readFile(new URL('../../../test/fixtures/vextjs/documentation-retrieval-tasks.json', import.meta.url), 'utf8'));
  assert.deepEqual([...new Set(tasks.flatMap((task) => task.expected))].sort(),
    exported.manifest.capabilities.map((item) => item.capabilityId).sort(), 'Independent tasks must cover every official topic');
  const retrieval = [];
  for (const task of tasks) {
    const candidates = await graph.retrieveCapabilities({ text: task.query, limit: 5 });
    const ids = candidates.items.map((item) => item.id.capabilityId);
    assert(task.expected.every((id) => ids.includes(id)), `${task.id}: expected documentation task omitted`);
    assert(task.expected.every((id) => ids.indexOf(id) < task.maxRank), `${task.id}: relevant capability ranked too low`);
    assert((task.excluded ?? []).every((id) => !ids.includes(id)), `${task.id}: explicitly excluded capability recalled`);
    if (!task.expected.length) assert.equal(ids.length, 0, `${task.id}: unsupported request recommended`);
    else if (task.chapter) {
      const document = exported.manifest.documents.find((item) => item.chapter === task.chapter);
      for (const id of task.expected) assert(document.capabilityIds.includes(id), `${task.id}: required official chapter unbound`);
      const evidence = await bound.queryKnowledge({ selected: task.expected.map((capabilityId) => ({ capabilityId })),
        knowledgeIds: [document.knowledgeId], text: task.text ?? document.title, limit: 3 });
      assertKnowledgeEvidence(evidence, task.id);
      const bytes = await readFile(path.join(sourceRoot, document.originalPath));
      for (const hit of evidence.items) assert.equal(bytes.subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
    }
    retrieval.push({ id: task.id, candidateIds: ids, expected: task.expected, officialChapter: task.chapter, status: 'passed' });
  }
  const positive = retrieval.filter((item) => item.expected.length);
  return { capabilities: exported.count, documents: results, retrieval, modelCalls: 0,
    retrievalMetrics: { taskCount: tasks.length, coveredTopics: new Set(tasks.flatMap((task) => task.expected)).size,
      recallAt5: positive.reduce((sum, item) => sum + item.expected.filter((id) => item.candidateIds.includes(id)).length / item.expected.length, 0) / positive.length,
      top1Rate: positive.filter((item) => item.expected.includes(item.candidateIds[0])).length / positive.length,
      meanPrecisionAt5: positive.reduce((sum, item) => sum + item.expected.filter((id) => item.candidateIds.includes(id)).length / item.candidateIds.length, 0) / positive.length,
      unknownFalsePositives: retrieval.filter((item) => !item.expected.length).reduce((sum, item) => sum + item.candidateIds.length, 0) },
    limitation: 'Complete document inventory and original-byte reading; implementation/Agent coverage is separate' };
}
