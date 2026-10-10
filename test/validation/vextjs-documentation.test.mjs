import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory, repositoryRoot } from '../../scripts/lib/artifact-paths.mjs';
import { exportVextProvider } from '../../examples/vextjs/documentation-provider.mjs';
import { documentationTopics } from '../../examples/vextjs/official-documents.mjs';

// Synthetic contract material, deliberately marked caller-declared; real upstream verification is separate.
async function fixture(root) {
  const sourceRoot = path.join(root, 'source');
  const chapters = new Set([...documentationTopics.flatMap((topic) => topic.chapters), 'index.mdx', 'benchmark.md',
    'resources/documentation-data-and-ai.md', 'resources/support-and-services.md', 'specification/index.md']);
  for (const chapter of chapters) {
    const file = path.join(sourceRoot, 'website/docs/zh', chapter); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `# Controlled ${chapter}\r\n\r\n原文 🧪 \\n <Component />\r\n`);
  }
  return { sourceRoot, repositoryRoot, version: '2.0.0', source: { identity: 'synthetic-contract', commit: 'a'.repeat(40) },
    catalog: { digest: 'contract', items: [{ id: 'C03', kind: 'capability' }, { id: 'R1', kind: 'rule' }, { id: 'K1', kind: 'knowledge' }] } };
}

test('documentation export uses semantic tasks and byte-exact Markdown, with native records confined to provenance', async () => {
  const root = await createTemporaryDirectory('vext-docs-contract-'); let graph;
  try {
    const options = await fixture(root);
    const a = await exportVextProvider({ ...options, outputDir: path.join(root, 'a') });
    const b = await exportVextProvider({ ...options, outputDir: path.join(root, 'b') });
    assert.deepEqual(a.manifest, b.manifest);
    const route = JSON.parse(await readFile(path.join(a.rootDir, 'capabilities/routing.json'), 'utf8'));
    assert.equal(route.capabilityId, 'routing'); assert.equal(route.requires, undefined);
    assert.deepEqual(route.knowledge.map((ref) => ref.knowledgeId), ['guide.routing', 'api.route-definition', 'specification.http-and-routing']);
    const native = JSON.parse(await readFile(path.join(a.rootDir, 'metadata/native-id-map.json')));
    assert.deepEqual(native.mappings.find((item) => item.nativeId === 'C03').capabilityIds, ['routing']);
    assert(native.mappings.filter((item) => item.role !== 'capability').every((item) => item.capabilityIds.length === 0));
    assert.equal(a.manifest.sourceVerification, 'caller-declared; contract fixture only');
    for (const document of a.manifest.documents) {
      assert.deepEqual(await readFile(path.join(a.rootDir, document.exportedPath)), await readFile(path.join(options.sourceRoot, document.originalPath)));
      assert.equal(document.sha256, document.exportedSha256);
    }
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'],
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: a.rootDir, definitionLayout: 'directory' } }] });
    const bound = graph.forProvider('vextjs');
    const detail = await bound.getCapabilities(['routing', 'frontend.rendering']); assert(detail.results.every((slot) => slot.ok));
    const selected = await bound.resolveSelection({ selected: ['routing'] }); assert.equal(selected.added.length, 0);
    const page = await bound.readDocumentPage({ capabilityId: 'routing', knowledgeId: 'guide.routing' });
    assert.equal(page.text, await readFile(path.join(options.sourceRoot, 'website/docs/zh/guide/routing.md'), 'utf8'));
    await assert.rejects(exportVextProvider({ ...options, outputDir: a.rootDir }), { code: 'EEXIST' });
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(repositoryRoot, 'forbidden-generated-provider') }), /outside/);
  } finally { await graph?.close(); await rm(root, { recursive: true, force: true }); }
});

test('documentation inventory rejects newly unclassified, missing and symlinked chapters', async () => {
  const root = await createTemporaryDirectory('vext-docs-inventory-');
  try {
    const options = await fixture(root); const docs = path.join(options.sourceRoot, 'website/docs/zh');
    const unknown = path.join(docs, 'guide/new-unreviewed.md'); await writeFile(unknown, '# New upstream feature');
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'unknown') }), /Unclassified official chapter/);
    await rm(unknown);
    await rm(path.join(docs, 'guide/routing.md'));
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'missing') }), /Missing official chapter/);
    // Windows needs elevated privileges for symlinks; missing/unclassified gates still run there.
    if (process.platform !== 'win32') {
      await symlink(path.join(docs, 'guide/plugins.md'), path.join(docs, 'guide/routing.md'));
      await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'linked') }), /symlink unsupported/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
