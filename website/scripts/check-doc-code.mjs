import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CapabilityGraph } from '../../dist/index.js';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

const docsRoot = path.join(websiteRoot, 'docs');
const readPage = (name) => readFile(path.join(docsRoot, `${name}.mdx`), 'utf8');
const fences = (source, language) => [...source.matchAll(new RegExp(
  '```' + language + '(?: title="([^"]+)")?\\r?\\n([\\s\\S]*?)\\r?\\n```', 'g'
))];

// Keep the scratch project under the root package so public self-imports resolve
// exactly as authored, without rewriting imports to private source paths.
const scratch = await mkdtemp(path.join(repositoryRoot, '.docs-code-'));
try {
  const tutorial = await readPage('getting-started/first-provider');
  const fixtureRoot = path.join(websiteRoot, 'fixtures', 'first-provider');
  const providerRoot = path.join(scratch, 'providers', 'acme-http');
  await cp(fixtureRoot, providerRoot, { recursive: true });

  for (const [, file, body] of fences(tutorial, 'md')) {
    assert(['PROVIDER.md', 'knowledge/routing.md'].includes(file), `unexpected tutorial file: ${file}`);
    assert.equal(body.trim(), (await readFile(path.join(fixtureRoot, file), 'utf8')).trim(), `${file} prose drift`);
    await writeFile(path.join(providerRoot, file), `${body}\n`, 'utf8');
  }
  for (const [, file, body] of fences(tutorial, 'json')) {
    if (!file) continue;
    assert(['provider.json', 'route.capability.json', 'route-http.capability.json'].includes(file));
    await writeFile(path.join(providerRoot, file), `${body}\n`, 'utf8');
  }
  const script = fences(tutorial, 'js').find(([, file]) => file === 'discover.mjs');
  assert(script, 'tutorial must expose a complete discover.mjs');
  await writeFile(path.join(scratch, 'discover.mjs'), script[2], 'utf8');
  const output = JSON.parse(execFileSync(process.execPath, [path.join(scratch, 'discover.mjs')], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000
  }));
  assert.deepEqual(output.catalog, ['route', 'route.http']);
  assert.equal(output.detail, 'route.http');
  assert.deepEqual(output.parents, ['route']);
  assert.equal(output.document, 'routing-guide');
  assert.equal(output.completeness, 'complete');
  assert.equal(output.text, await readFile(path.join(providerRoot, 'knowledge/routing.md'), 'utf8'));
  const expected = JSON.parse(fences(tutorial, 'json').find(([, file]) => !file)[2]);
  const { text, ...projection } = output;
  assert.deepEqual(projection, expected, 'documented expected output drifted');

  const installation = fences(await readPage('getting-started/installation'), 'js')[0];
  await writeFile(path.join(scratch, 'check.mjs'), installation[2], 'utf8');
  assert.equal(execFileSync(process.execPath, [path.join(scratch, 'check.mjs')], {
    cwd: scratch, encoding: 'utf8', timeout: 30_000
  }).trim(), 'function');

  const bound = "import type { BoundProviderGraph } from '@devcodex/capability-graph';\ndeclare const provider: BoundProviderGraph;\n";
  const pages = new Map([
    ['getting-started/provider-owned-api', ''],
    ['guides/design-relations', bound],
    ['guides/add-local-knowledge', bound],
    ['guides/errors-and-partial-results', bound],
    ['guides/lifecycle-and-reload', ''],
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
    rootDir: scratch, outDir: path.join(scratch, 'compiled'), skipLibCheck: true
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => repositoryRoot, getCanonicalFileName: (file) => file, getNewLine: () => '\n'
  }));
  assert.equal(program.emit().emitSkipped, false);

  const { listMainCapabilities } = await import(pathToFileURL(path.join(scratch, 'compiled', 'getting-started-provider-owned-api.mjs')).href);
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ['acme.http'], integrationEnabledProviders: ['acme.http'],
    providers: [{ providerId: 'acme.http', authority: { kind: 'file', rootDir: providerRoot } }]
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
  const definitionFile = path.join(providerRoot, 'route-http.capability.json');
  const definition = JSON.parse(await readFile(definitionFile, 'utf8'));
  definition.knowledge[0].locator = { type: 'http', url: 'https://example.test/routing' };
  await writeFile(definitionFile, JSON.stringify(definition), 'utf8');
  const remote = await CapabilityGraph.open({
    hostAllowedProviders: ['acme.http'], integrationEnabledProviders: ['acme.http'],
    providers: [{ providerId: 'acme.http', authority: { kind: 'file', rootDir: providerRoot } }],
    readers: [createHttpReader(async () => new TextEncoder().encode('Reader contract example'))]
  });
  try {
    const result = await remote.forProvider('acme.http').readDocuments({ selected: ['route.http'] });
    assert(result.results[0]?.ok, JSON.stringify(result));
    assert.equal(result.results[0].value.text, 'Reader contract example');
  } finally {
    await remote.close();
  }
  console.log(`document code check passed: tutorial executed, expected output matched, ${sources.length} typed examples, API/Reader contracts`);
} finally {
  // Only remove the exact temporary directory allocated above.
  assert.equal(path.dirname(scratch), repositoryRoot);
  assert(path.basename(scratch).startsWith('.docs-code-'));
  await rm(scratch, { recursive: true, force: true });
}
