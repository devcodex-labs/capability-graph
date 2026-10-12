import assert from 'node:assert/strict';
import { readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory, repositoryRoot } from '../lib/artifact-paths.mjs';
import { VextMcpClient } from '../../examples/vextjs/mcp-client.mjs';
import { exportNativeProvider, readNativeCatalog } from '../../examples/vextjs/native-provider.mjs';
import { verifyVextSource } from '../../examples/vextjs/source-provenance.mjs';

/** Fixed upstream MCP declaration audit, independent of runtime observation and retrieval. */
export async function validateVextjs({ frameworkRoot, projectRoot, sourceIdentity, sourceRoot = frameworkRoot, graphClass = CapabilityGraph }) {
  frameworkRoot = await realpath(frameworkRoot); projectRoot = await realpath(projectRoot); sourceRoot = await realpath(sourceRoot);
  const source = await verifyVextSource({ frameworkRoot, sourceRoot, sourceIdentity });
  const temporary = await createTemporaryDirectory('capability-graph-vextjs-');
  const client = new VextMcpClient({ cli: path.join(frameworkRoot, 'dist/cli/index.js'), projectRoot }); let graph;
  try {
    await client.initialize();
    const { buildMcpCatalog } = await import(pathToFileURL(path.join(frameworkRoot, 'dist/assistant/catalog.js')).href);
    const catalog = await readNativeCatalog(client, buildMcpCatalog());
    const version = JSON.parse(await readFile(path.join(frameworkRoot, 'package.json'), 'utf8')).version;
    const exported = await exportNativeProvider({ catalog, version, source, outputDir: path.join(temporary, 'native-audit'), repositoryRoot });
    graph = await graphClass.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'],
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', rootDir: exported.rootDir, definitionLayout: 'directory' } }] });
    const actual = []; let cursor;
    do { const page = await graph.forProvider('vextjs').listCatalog({ limit: 20, ...(cursor ? { cursor } : {}) });
      assert.equal(page.meta.warnings.length, 0); actual.push(...page.items.map((item) => item.id.capabilityId)); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(actual.length, exported.count); assert.equal(new Set(actual).size, actual.length);
    for (const capabilityId of actual) {
      assert((await graph.forProvider('vextjs').getCapabilities([capabilityId])).results[0]?.ok);
      assert.deepEqual((await graph.forProvider('vextjs').resolveSelection({ selected: [capabilityId] })).resolved.map((id) => id.capabilityId), [capabilityId]);
    }
    return { node: process.version, platform: process.platform, sourceIdentity, source, purpose: 'Fixed native MCP declarations and graph loading',
      nativeCatalogDigest: catalog.digest, exportedCount: exported.count, checkedCapabilities: actual.length,
      sourceVerification: exported.manifest.sourceVerification, nativeExports: exported.manifest.nativeExports,
      limitation: 'Declaration audit and static queries; no framework business execution, running instance observation or retrieval quality claim' };
  } finally { try { await graph?.close(); } finally { try { await client.close(); } finally { await rm(temporary, { recursive: true, force: true }); } } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [frameworkRoot, projectRoot, sourceIdentity, sourceRoot] = process.argv.slice(2);
  if (!frameworkRoot || !projectRoot || !sourceIdentity) throw new Error('Usage: vextjs.mjs <built-fixed-framework> <project-root> <commit> [source-checkout]');
  console.log(JSON.stringify(await validateVextjs({ frameworkRoot, projectRoot, sourceIdentity, ...(sourceRoot ? { sourceRoot } : {}) }), null, 2));
}
