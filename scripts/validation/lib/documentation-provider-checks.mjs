import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../../examples/vextjs/source-provenance.mjs';

/** Inspect the exported layout, every original chapter and actual Core pages, with independent task expectations. */
export async function verifyDocumentationProvider({ graph, exported, sourceRoot }) {
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
  const catalog = []; let cursor;
  do { const page = await bound.listCatalog({ limit: 20, ...(cursor ? { cursor } : {}) });
    assert.equal(page.meta.warnings.length, 0); catalog.push(...page.items.map((item) => item.id.capabilityId)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(catalog.sort(), exported.manifest.capabilities.map((item) => item.capabilityId).sort());
  for (const capabilityId of catalog) {
    const details = await bound.getCapabilities([capabilityId]); assert(details.results[0]?.ok);
    const selection = await bound.resolveSelection({ selected: [capabilityId] });
    assert.deepEqual(selection.resolved.map((id) => id.capabilityId), [capabilityId]); assert.equal(selection.added.length, 0);
    const neighbors = await bound.getNeighbors(capabilityId); assert.equal(neighbors.meta.completeness, 'complete');
  }
  return { capabilities: exported.count, documents: results, catalogCoverage: catalog.length, selectionCoverage: catalog.length,
    limitation: 'Complete document inventory, static queries and original-byte reading; document associations do not establish framework execution or Agent success' };
}
