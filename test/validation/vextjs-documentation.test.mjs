import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rm, writeFile, symlink, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory, repositoryRoot } from '../../scripts/lib/artifact-paths.mjs';
import { exportVextProvider } from '../../examples/vextjs/documentation-provider.mjs';
import { documentationTopics } from '../../examples/vextjs/official-documents.mjs';
import { verifyVextSource, assertVerifiedDocument } from '../../examples/vextjs/source-provenance.mjs';

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

test('verified export binds the checkout and committed bytes, including changes hidden from git status', async () => {
  const root = await createTemporaryDirectory('vext-docs-provenance-');
  try {
    const options = await fixture(root);
    const git = (...args) => execFileSync('git', ['-C', options.sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    // Controlled build modules exercise provenance mechanics; real VextJS is a separate CI input.
    for (const [file, body] of [
      // These fixture documents deliberately contain CRLF; commit the exact bytes on every platform.
      ['.gitattributes', 'website/docs/zh/** -text\n'],
      ['package.json', JSON.stringify({ name: 'vextjs', version: '2.0.0', type: 'module' })],
      ['scripts/implementation-manifest.mjs', 'export const inspectBuildInputs = () => ({ inputDigest: "controlled", packageVersion: "2.0.0" });'],
      ['src/lib/project/implementation-fingerprint.mjs', 'export const fingerprintImplementationTree = () => "controlled-output";'],
      ['dist/.implementation.json', JSON.stringify({ state: 'complete', inputDigest: 'controlled', outputDigest: 'controlled-output', digest: 'controlled' })],
    ]) {
      const target = path.join(options.sourceRoot, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, body);
    }
    git('init', '--quiet'); git('add', '.');
    git('-c', 'user.name=Capability Graph Tests', '-c', 'user.email=tests@example.invalid', 'commit', '--quiet', '-m', 'Controlled source fixture');
    options.source = await verifyVextSource({ frameworkRoot: options.sourceRoot, sourceIdentity: git('rev-parse', 'HEAD') });
    const good = await exportVextProvider({ ...options, outputDir: path.join(root, 'good') });
    assert.equal(good.manifest.sourceVerification, 'verified-fixed-source-build');
    const alternate = path.join(root, 'alternate'); await cp(options.sourceRoot, alternate, { recursive: true });
    await assert.rejects(exportVextProvider({ ...options, sourceRoot: alternate, outputDir: path.join(root, 'alternate-output') }), /differs from the verified checkout/);
    const originalPath = 'website/docs/zh/guide/routing.md';
    const original = await readFile(path.join(options.sourceRoot, originalPath));
    assertVerifiedDocument(options.source, originalPath, original);
    assert.throws(() => assertVerifiedDocument(options.source, originalPath, Buffer.from('replaced')), /differs from the verified commit/);
    git('update-index', '--assume-unchanged', originalPath);
    await writeFile(path.join(options.sourceRoot, originalPath), '# Controlled replacement\n');
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'drift') }), /differs from the verified commit/);
    git('update-index', '--no-assume-unchanged', originalPath);
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'dirty') }), /tracked source changed/);
    await writeFile(path.join(options.sourceRoot, originalPath), original);
    git('-c', 'user.name=Capability Graph Tests', '-c', 'user.email=tests@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Changed controlled checkout');
    await assert.rejects(exportVextProvider({ ...options, outputDir: path.join(root, 'new-commit') }), /checkout commit changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
