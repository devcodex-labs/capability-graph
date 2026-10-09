import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory } from '../lib/website-paths.mjs';
import { TextKnowledgeRetriever } from '../../dist-test/examples/seed-runtime/text-retrieval.js';
async function markdownFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(file));
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) files.push(file);
  }
  return files.sort();
}
const framework = await realpath(process.argv[2]);
const root = await createTemporaryDirectory('capability-graph-vext-documents-');
let graph;
try {
  await mkdir(path.join(root, 'knowledge'));
  await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'vextdocs', name: 'Unmodified Vext documentation', version: 'fixed-source' }));
  const documents = [];
  for (const file of await markdownFiles(path.join(framework, 'website/docs/zh'))) {
    const body = await readFile(file); if (body.length <= 32768) continue;
    const id = `doc${documents.length}`; const locator = `knowledge/${id}.md`;
    await writeFile(path.join(root, locator), body);
    await writeFile(path.join(root, `${id}.capability.json`), JSON.stringify({ capabilityId: id, name: path.basename(file), description: 'Original official document', whenToUse: 'Read complete original guidance', knowledge: [{ kind: 'document', knowledgeId: id, role: 'guide', locator: { type: 'relative-file', path: locator } }] }));
    documents.push({ id, file: path.relative(framework, file), body });
  }
  assert(documents.length > 0);
  graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextdocs'], integrationEnabledProviders: ['vextdocs'], providers: [{ providerId: 'vextdocs', authority: { kind: 'file', rootDir: root } }], knowledgeRetriever: new TextKnowledgeRetriever() });
  const bound = graph.forProvider('vextdocs'); const results = [];
  for (const document of documents) {
    const started = performance.now(); let cursor; let pages = 0; let text = ''; let contentId;
    do {
      const page = await bound.readDocumentPage({ capabilityId: document.id, knowledgeId: document.id, ...(cursor ? { cursor } : {}) });
      contentId ??= page.contentId; assert.equal(page.contentId, contentId); assert.equal(page.totalBytes, document.body.length);
      text += page.text; pages++; cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(Buffer.from(text), document.body); assert(pages > 1);
    const search = await bound.queryKnowledge({ selected: [{ capabilityId: document.id }], text: path.basename(document.file).replace(/\..+$/, ''), limit: 2 });
    assert.equal(search.meta.completeness, 'complete');
    results.push({ file: document.file, bytes: document.body.length, pages, contentId, exactReconstruction: true, knowledgeHits: search.items.length, durationMs: performance.now() - started });
  }
  console.log(JSON.stringify({ node: process.version, documentCount: documents.length, pageBudget: 32768, totalSizeAdmissionCap: false, results }, null, 2));
} finally { await graph?.close(); await rm(root, { recursive: true, force: true }); }
