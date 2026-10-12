import { rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createTemporaryDirectory, repositoryRoot } from '../lib/artifact-paths.mjs';
import { verifyVextSource } from '../../examples/vextjs/source-provenance.mjs';
import { exportVextProvider } from '../../examples/vextjs/documentation-provider.mjs';
import { verifyDocumentationProvider } from './lib/documentation-provider-checks.mjs';

/** Real fixed-source documentation checks, independent of MCP, MongoDB and business application setup. */
export async function validateVextDocumentation({ frameworkRoot, sourceRoot = frameworkRoot, sourceIdentity, graphClass = CapabilityGraph }) {
  sourceRoot = await realpath(sourceRoot);
  const source = await verifyVextSource({ frameworkRoot, sourceRoot, sourceIdentity });
  const root = await createTemporaryDirectory('vext-docs-real-'); let graph;
  try {
    const exported = await exportVextProvider({ providerId: 'vextjs', version: source.version, source, sourceRoot,
      outputDir: path.join(root, 'provider'), repositoryRoot });
    graph = await graphClass.open({ hostAllowedProviders: ['vextjs'], integrationEnabledProviders: ['vextjs'],
      providers: [{ providerId: 'vextjs', authority: { kind: 'file', definitionLayout: 'directory', rootDir: exported.rootDir } }] });
    return { source, ...await verifyDocumentationProvider({ graph, exported, sourceRoot }) };
  } finally { await graph?.close(); await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [frameworkRoot, sourceIdentity, sourceRoot = frameworkRoot] = process.argv.slice(2);
  if (!frameworkRoot || !sourceIdentity) throw new Error('Usage: node scripts/validation/vextjs-documentation.mjs <built-fixed-framework> <full-commit> [source-checkout]');
  console.log(JSON.stringify(await validateVextDocumentation({ frameworkRoot, sourceRoot, sourceIdentity }), null, 2));
}
