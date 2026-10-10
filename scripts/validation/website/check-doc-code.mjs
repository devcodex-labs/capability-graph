import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CapabilityGraph } from '../../../dist/index.js';
import { repositoryRoot, websiteRoot, websiteFixtureRoot, artifactsRoot, createTemporaryDirectory } from '../../lib/website-paths.mjs';
import { verifyTutorialSuite } from './lib/tutorial.mjs';
import { verifyLifecycleExample } from './lib/lifecycle.mjs';
import { installLocalConsumer } from './lib/consumer.mjs';

const docsRoot = path.join(websiteRoot, 'docs');
const readPage = (name) => readFile(path.join(docsRoot, `${name}.mdx`), 'utf8');
const fences = (source, language) => [...source.matchAll(new RegExp(
  '```' + language + '(?: title="([^"]+)")?\\r?\\n([\\s\\S]*?)\\r?\\n```', 'g'
))];

// Exercise public imports from a real consumer outside the repository.
const scratch = await createTemporaryDirectory('.docs-code-');
try {
  await installLocalConsumer(scratch, { types: true });
  const tutorialChecks = await verifyTutorialSuite(scratch);
  const fixtureRoot = path.join(websiteFixtureRoot, 'advanced-provider');
  // Keep the advanced Reader/API fixture independent of page materialization.
  const providerRoot = path.join(scratch, 'legacy-provider');
  await cp(fixtureRoot, providerRoot, { recursive: true });

  const installation = fences(await readPage('getting-started/installation'), 'js')[0];
  await writeFile(path.join(scratch, 'check.mjs'), installation[2], 'utf8');
  assert.equal(execFileSync(process.execPath, [path.join(scratch, 'check.mjs')], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000
  }).trim(), 'function');

  await verifyLifecycleExample(scratch);

  const bound = "import type { BoundProviderGraph } from '@devcodex/capability-graph';\ndeclare const provider: BoundProviderGraph;\n";
  const pages = new Map([
    ['getting-started/provider-owned-api', ''],
    ['guides/design-relations', bound],
    ['guides/add-local-knowledge', bound],
    ['guides/errors-and-partial-results', bound],
    ['guides/multiple-providers', ''],
    ['guides/use-runtime', "import { CapabilityGraph, type RuntimeAdapter } from '@devcodex/capability-graph';\ndeclare const runtimeAdapter: RuntimeAdapter;\n"],
    ['integrations/node-api', '']
  ]);
  const sources = [];
  for (const [page, preamble] of pages) {
    const blocks = fences(await readPage(page), 'ts');
    assert(blocks.length, `${page} has no typed example`);
    const file = path.join(scratch, `${page.replaceAll('/', '-')}.mts`);
    await writeFile(file, `${preamble}${blocks.map((block) => block[2]).join('\n')}\n`, 'utf8');
    sources.push(file);
  }
  for (const page of ['runtime-adapter', 'knowledge-reader', 'database-authority-adapter', 'capability-retriever']) {
    const skeletons = fences(await readPage(`integrations/${page}`), 'ts').filter(([, title]) => title);
    assert(skeletons.length, `${page} must include a typed implementation boundary`);
    for (const [, title, body] of skeletons) {
      assert(/^[a-z-]+\.ts$/.test(title), 'invalid skeleton filename');
      const file = path.join(scratch, title.replace(/\.ts$/, '.mts'));
      await writeFile(file, body, 'utf8');
      sources.push(file);
    }
  }
  const program = ts.createProgram(sources, {
    strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'],
    rootDir: scratch, outDir: path.join(scratch, 'compiled'), skipLibCheck: true,
    typeRoots: [path.join(scratch, 'node_modules/@types')]
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => repositoryRoot, getCanonicalFileName: (file) => file, getNewLine: () => '\n'
  }));
  assert.equal(program.emit().emitSkipped, false);

  const { listMainCapabilities } = await import(pathToFileURL(path.join(scratch, 'compiled', 'getting-started-provider-owned-api.mjs')).href);
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ['acme.http'], integrationEnabledProviders: ['acme.http'],
    providers: [{ providerId: 'acme.http', authority: { kind: 'file', definitionLayout: 'directory', rootDir: providerRoot } }]
  });
  try {
    const main = await listMainCapabilities(graph);
    assert.deepEqual(main.capabilities.map((item) => item.id.capabilityId), ['route']);
    assert.equal(main.meta.completeness, 'complete');
    assert(!('knowledge' in main.capabilities[0]), 'main entry leaks detail');
  } finally {
    await graph.close();
  }

  // A contract fixture proves the skeleton's content hash through the Core,
  // but does not claim a production HTTP transport has been implemented.
  const { createHttpReader } = await import(pathToFileURL(path.join(scratch, 'compiled', 'reader-skeleton.mjs')).href);
  const definitionFile = path.join(providerRoot, 'capabilities/route-http.json');
  const definition = JSON.parse(await readFile(definitionFile, 'utf8'));
  definition.knowledge[0].locator = { type: 'http', url: 'https://example.test/routing' };
  await writeFile(definitionFile, JSON.stringify(definition), 'utf8');
  const remote = await CapabilityGraph.open({
    hostAllowedProviders: ['acme.http'], integrationEnabledProviders: ['acme.http'],
    providers: [{ providerId: 'acme.http', authority: { kind: 'file', definitionLayout: 'directory', rootDir: providerRoot } }],
    readers: [createHttpReader(async () => new TextEncoder().encode('Reader contract example'))]
  });
  try {
    const result = await remote.forProvider('acme.http').readDocuments({ selected: ['route.http'] });
    assert(result.results[0]?.ok, JSON.stringify(result));
    assert.equal(result.results[0].value.text, 'Reader contract example');
  } finally {
    await remote.close();
  }
  console.log(`document code check passed: ${tutorialChecks.checkpoints.join('/')}, ${tutorialChecks.g4Cases.join('/')}, ${sources.length} typed examples, lifecycle revision/recovery, legacy API/Reader contracts`);
} finally {
  // Only remove the exact temporary directory allocated above.
  assert.equal(path.dirname(scratch), artifactsRoot);
  assert(path.basename(scratch).startsWith('.docs-code-'));
  await rm(scratch, { recursive: true, force: true });
}
