import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProxyAgent } from 'proxy-agent';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { bindKnowledgeRoots } from '../../dist/knowledge/roots.js';
import { HttpKnowledgeReader } from '../../dist-test/examples/seed-runtime/knowledge-reader.js';
import { TextKnowledgeRetriever } from '../../dist-test/examples/seed-runtime/text-retrieval.js';
import { createTemporaryDirectory, repositoryRoot } from '../lib/artifact-paths.mjs';
import { verifyVextSource, sha256 } from '../../examples/vextjs/source-provenance.mjs';
import { officialDocumentMappings } from '../../examples/vextjs/official-documents.mjs';
import { exportVextProvider } from '../../examples/vextjs/native-provider.mjs';
import { assertKnowledgeEvidence } from './lib/retrieval-assertions.mjs';
import { verifyInstalledDocuments } from './lib/package-provenance.mjs';

/** Real direct-source matrix. All generated provider definitions/snapshots are outside the repository. */
export async function validateProviderSources({ sourceRoot, installedProject, includeHttps = false, sourceIdentity }) {
  sourceRoot = await realpath(sourceRoot); installedProject = await realpath(installedProject);
  const bindings = await bindKnowledgeRoots({ vext: { kind: 'package', packageName: 'vextjs', resolveFrom: installedProject }, mongo: { kind: 'package', packageName: 'monsqlize', resolveFrom: installedProject } });
  const frameworkRoot = bindings.vext.rootDir; const monsqlizeRoot = bindings.mongo.rootDir;
  const source = await verifyVextSource({ sourceRoot, frameworkRoot, sourceIdentity });
  const monsqlize = JSON.parse(await readFile(path.join(monsqlizeRoot, 'package.json'), 'utf8'));
  assert.equal(monsqlize.name, 'monsqlize'); assert.match(monsqlize.version, /^\d+\.\d+\.\d+/);
  const temporary = await createTemporaryDirectory('capability-graph-provider-sources-');
  const providers = path.join(temporary, 'providers'); await mkdir(providers);
  const agent = new ProxyAgent();
  const reader = new HttpKnowledgeReader({ allowedOrigins: ['https://raw.githubusercontent.com'], timeoutMs: 30000,
    agentForUrl: () => agent, snapshot: { directory: path.join(temporary, 'snapshots') } });
  let graph;
  try {
    const { buildMcpCatalog } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/assistant/catalog.js')).href);
    const catalog = buildMcpCatalog(); const official = await officialDocumentMappings(sourceRoot, catalog, source.commit);
    const exported = await exportVextProvider({ catalog, version: source.version, source, officialDocuments: official,
      outputDir: path.join(providers, 'vextjs'), repositoryRoot });
    const tasks = JSON.parse(await readFile(new URL('../../test/fixtures/vextjs/document-tasks.json', import.meta.url), 'utf8'));
    const cases = []; const provenance = [];
    const add = async (providerId, capabilityId, knowledgeId, locator, originalFile, query, evidence, role = 'guide', originalUrl) => {
      const original = await readFile(originalFile);
      const installed = locator.type === 'relative-file' && ['installed', 'installed-directory'].includes(locator.root);
      const locale = installed ? 'en' : 'zh';
      const record = { capabilityId, name: capabilityId, description: 'Integration-authored association to original published documentation', whenToUse: query,
        knowledge: [{ kind: 'document', knowledgeId, role, locale, locator, ...(originalUrl ? { canonicalUrl: originalUrl } : {}) }] };
      await writeFile(path.join(providers, providerId, 'capabilities', `${capabilityId}.json`), JSON.stringify(record, null, 2) + '\n');
      cases.push({ providerId, capabilityId, knowledgeId, locator, original, query, evidence });
      provenance.push({ providerId, capabilityId, knowledgeId, locator, originalPath: providerId === 'monsqlize' ? path.relative(monsqlizeRoot, originalFile) : path.relative(installed ? frameworkRoot : sourceRoot, originalFile),
        originalUrl, originalSha256: sha256(original), readSha256: null, transformation: 'none; direct exact bytes', role, locale,
        sourceIdentity: providerId === 'monsqlize' ? `installed:${monsqlize.name}@${monsqlize.version}` : source.identity });
    };
    for (const [index, task] of tasks.entries()) await add('vextjs', `docs.${index}`, `DOC-${index}`,
      { type: 'relative-file', root: 'official', path: `website/docs/zh/${task.path}` }, path.join(sourceRoot, 'website/docs/zh', task.path), task.query, task.evidence);
    await add('vextjs', 'documentation', 'PKG-README', { type: 'relative-file', root: 'installed', path: 'README.md' }, path.join(frameworkRoot, 'README.md'), 'VextJS', 'VextJS');
    const monRoot = path.join(providers, 'monsqlize'); await mkdir(path.join(monRoot, 'capabilities'), { recursive: true });
    await writeFile(path.join(monRoot, 'provider.json'), JSON.stringify({ providerId: 'monsqlize', name: 'MonSQLize installed documentation', version: monsqlize.version }));
    await add('monsqlize', 'documentation', 'PKG-README', { type: 'relative-file', root: 'installed', path: 'README.md' }, path.join(monsqlizeRoot, 'README.md'), 'MonSQLize', 'MonSQLize');
    for (const [providerId, packageRoot, file, query, evidence, role] of [
      ['vextjs', frameworkRoot, 'CHANGELOG.md', 'Semantic Versioning', 'Semantic Versioning', 'reference'],
      ['vextjs', frameworkRoot, 'MIGRATION.md', 'app.db', 'app.db', 'guide'],
      ['monsqlize', monsqlizeRoot, 'CHANGELOG.md', 'schema-dsl', 'schema-dsl', 'reference'],
      ['monsqlize', monsqlizeRoot, 'MIGRATION.md', 'schema-dsl/runtime', 'schema-dsl/runtime', 'guide'],
    ]) await add(providerId, `installed.${file.toLowerCase()}`, `PKG-${file}`,
      { type: 'relative-file', root: 'installed', path: file }, path.join(packageRoot, file), query, evidence, role);
    // An installed directory can also be bound explicitly without the package resolver.
    await add('vextjs', 'installed.directory', 'DIRECTORY-MIGRATION',
      { type: 'relative-file', root: 'installed-directory', path: 'MIGRATION.md' }, path.join(frameworkRoot, 'MIGRATION.md'), 'app.db', 'app.db');
    if (includeHttps) {
      for (const [capabilityId, knowledgeId, originalPath, query, evidence] of [
        ['docs.https', 'HTTPS-CONFIG', 'website/docs/zh/api/config.md', 'bodyParser', 'bodyParser'],
        ['docs.https.short', 'HTTPS-HELLO', 'website/docs/zh/examples/hello-world.md', 'defineRoutes', 'defineRoutes'],
      ]) {
        const url = `https://raw.githubusercontent.com/devcodex-labs/vextjs/${source.commit}/${originalPath}`;
        await add('vextjs', capabilityId, knowledgeId, { type: 'http', url }, path.join(sourceRoot, originalPath), query, evidence, 'guide', url);
      }
    }
    const knowledge = new TextKnowledgeRetriever();
    const monsqlizeRegistry = includeHttps ? await verifyInstalledDocuments({ packageRoot: monsqlizeRoot, lockRoot: sourceRoot,
      outputDirectory: temporary, documents: ['package.json', 'README.md', 'CHANGELOG.md', 'MIGRATION.md'] }) : undefined;
    graph = await CapabilityGraph.open({ hostAllowedProviders: ['vextjs', 'monsqlize'], integrationEnabledProviders: ['vextjs', 'monsqlize'], readers: [reader], knowledgeRetriever: knowledge,
      providers: [
        { providerId: 'vextjs', authority: { kind: 'file', rootDir: exported.rootDir, definitionLayout: 'directory' }, knowledgeRoots: {
          official: { kind: 'directory', rootDir: sourceRoot }, installed: { kind: 'package', packageName: 'vextjs', resolveFrom: installedProject },
          'installed-directory': { kind: 'directory', rootDir: frameworkRoot } } },
        { providerId: 'monsqlize', authority: { kind: 'file', rootDir: monRoot, definitionLayout: 'directory' }, knowledgeRoots: {
          installed: { kind: 'package', packageName: 'monsqlize', resolveFrom: installedProject } } },
      ] });
    const results = [];
    for (const [index, item] of cases.entries()) {
      const bound = graph.forProvider(item.providerId); let cursor; let reconstructed = ''; let pages = 0; let expectedOffset = 0;
      const query = { capabilityId: item.capabilityId, knowledgeId: item.knowledgeId };
      do { const page = await bound.readDocumentPage({ ...query, ...(cursor ? { cursor } : {}) });
        assert.equal(page.totalBytes, item.original.length); assert.equal(page.startOffset, expectedOffset);
        assert.equal(page.contentId, `k:${sha256(item.original).slice(0, 16)}`);
        const bytes = Buffer.from(page.text); assert.equal(page.byteLength, bytes.length);
        assert(bytes.length <= 32768); assert(page.endOffset > page.startOffset || item.original.length === 0);
        assert.deepEqual(bytes, item.original.subarray(page.startOffset, page.endOffset));
        assert.equal(page.pageContentId, `k:${sha256(bytes).slice(0, 16)}`);
        assert.equal(page.hasMore, page.endOffset < item.original.length); assert.equal(Boolean(page.nextCursor), page.hasMore);
        assert.equal(page.complete, page.startOffset === 0 && !page.hasMore);
        expectedOffset = page.endOffset; reconstructed += page.text; cursor = page.nextCursor; pages++; } while (cursor);
      assert.equal(expectedOffset, item.original.length);
      assert.equal(pages > 1, item.original.length > 32768);
      assert.deepEqual(Buffer.from(reconstructed), item.original); provenance[index].readSha256 = sha256(Buffer.from(reconstructed));
      const search = await bound.queryKnowledge({ selected: [{ capabilityId: item.capabilityId }], knowledgeIds: [item.knowledgeId], text: item.query, limit: 3 });
      assertKnowledgeEvidence(search, `${item.providerId}/${item.capabilityId}`);
      assert(search.items.some((hit) => hit.snippet.toLowerCase().includes(item.evidence.toLowerCase())), 'Independent expected text absent from retrieved evidence');
      for (const hit of search.items) assert.equal(item.original.subarray(hit.startOffset, hit.endOffset).toString(), hit.snippet);
      results.push({ providerId: item.providerId, capabilityId: item.capabilityId, knowledgeId: item.knowledgeId, locator: item.locator,
        bytes: item.original.length, pages, query: item.query, knowledgeHits: search.items.length, exactReconstruction: true });
    }
    // The same local capabilityId/knowledgeId resolves to independently attributed provider sources.
    const shared = await graph.readDocuments({ selected: [{ providerId: 'vextjs', capabilityId: 'documentation' }, { providerId: 'monsqlize', capabilityId: 'documentation' }] });
    assert(shared.results.every((slot) => slot.ok)); assert.equal(new Set(shared.results.map((slot) => slot.value.id.providerId)).size, 2);
    for (const providerId of ['vextjs', 'monsqlize']) {
      const before = (await graph.getProvider(providerId)).staticRevision;
      assert((await graph.reload({ providerId })).ok); assert.equal((await graph.getProvider(providerId)).staticRevision, before);
      await knowledge.invalidate({ providerId, staticRevision: before, reason: 'metadata' });
      assertKnowledgeEvidence(await graph.forProvider(providerId).queryKnowledge({ selected: [{ capabilityId: 'documentation' }], text: providerId }), `${providerId}/reload`);
    }
    const packageDocs = ['README.md', 'CHANGELOG.md', 'MIGRATION.md']; const installedDocuments = [];
    for (const file of packageDocs) { const bytes = await readFile(path.join(frameworkRoot, file)); installedDocuments.push({ file, sha256: sha256(bytes), bytes: bytes.length }); }
    let websitePackaged = true; try { await readFile(path.join(frameworkRoot, 'website/docs/zh/api/config.md')); } catch { websitePackaged = false; }
    return { node: process.version, platform: process.platform, source, matrix: results, provenance, officialAssociations: official,
      monsqlizeRegistry,
      monsqlize: { name: monsqlize.name, version: monsqlize.version, packageJsonSha256: sha256(await readFile(path.join(monsqlizeRoot, 'package.json'))),
        identityScope: 'Actual installed package and original-document fingerprints; registry integrity is a separate verification' },
      installedDocuments, websitePackaged, totalSizeAdmissionCap: false, sharedIdentityIsolation: true, reloads: ['vextjs', 'monsqlize'],
      limitation: 'Document read/retrieval coverage does not establish framework behavior, database execution or Agent success. Native MCP readback is gated by vextjs.mjs separately.' };
  } finally { await graph?.close(); await reader.close(); agent.destroy(); await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceRoot, installedProject, sourceIdentity, flag] = process.argv.slice(2);
  if (!sourceRoot || !installedProject || !sourceIdentity) throw new Error('Usage: provider-sources.mjs <fixed-source-root> <installed-project> <commit> [--https]');
  console.log(JSON.stringify(await validateProviderSources({ sourceRoot, installedProject, sourceIdentity, includeHttps: flag === '--https' }), null, 2));
}
