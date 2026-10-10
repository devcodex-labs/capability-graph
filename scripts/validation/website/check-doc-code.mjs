import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { CapabilityGraph } from '../../../dist/index.js';
import { repositoryRoot, artifactsRoot, createTemporaryDirectory } from '../../lib/artifact-paths.mjs';
import { websiteRoot, websiteFixtureRoot } from '../../lib/website-paths.mjs';
import { verifyTutorialSuite } from './lib/tutorial.mjs';
import { verifyLifecycleExample } from './lib/lifecycle.mjs';
import { installLocalConsumer } from './lib/consumer.mjs';
import { verifyDocumentedReaderFactory } from './lib/adapter-contracts.mjs';

const docsRoot = path.join(websiteRoot, 'docs');
const readPage = (name) => readFile(path.join(docsRoot, `${name}.mdx`), 'utf8');
const fences = (source, language) => [...source.matchAll(new RegExp(
  '```' + language + '(?: title="([^"]+)")?\\r?\\n([\\s\\S]*?)\\r?\\n```', 'g'
))];

// Exercise public imports from a real consumer outside the repository.
const scratch = await createTemporaryDirectory('.docs-code-');
try {
  await installLocalConsumer(scratch, { types: true, dependencies: ['bcp-47@2.1.1'] });
  await writeFile(path.join(scratch, 'consumer-api.mjs'), "export { CapabilityGraph, CapabilityGraphError } from '@devcodex/capability-graph';\n");
  const { CapabilityGraph: ConsumerGraph, CapabilityGraphError: ConsumerError } = await import(pathToFileURL(path.join(scratch, 'consumer-api.mjs')).href);
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
  await verifyDocumentedReaderFactory(createHttpReader, ConsumerGraph);
  const definitionFile = path.join(providerRoot, 'capabilities/route-http.json');
  const definition = JSON.parse(await readFile(definitionFile, 'utf8'));
  definition.knowledge[0].locator = { type: 'http', url: 'https://example.test/routing' };
  await writeFile(definitionFile, JSON.stringify(definition), 'utf8');
  const remote = await ConsumerGraph.open({
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

  // Materialize the guide's definitions and scripts, with independent real source bodies.
  const sourcePage = await readPage('guides/add-local-knowledge');
  const sourceRoot = path.join(scratch, 'knowledge-sources');
  const required = ['providers/acme.http/provider.json', 'providers/acme.http/capabilities/route-http.json',
    'knowledge-sources.mjs', 'read-source.mjs'];
  const blocks = [...fences(sourcePage, 'json'), ...fences(sourcePage, 'js')].filter(([, title]) => title);
  assert.deepEqual(blocks.map(([, title]) => title).sort(), [...required].sort(), 'source guide files are incomplete');
  for (const [, title, body] of blocks) {
    assert(required.includes(title)); const file = path.join(sourceRoot, title);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body);
  }
  const localBytes = Buffer.from('\uFEFFLocal original 中文🙂\r\n'.repeat(200));
  const directoryBytes = Buffer.from('Approved directory 原始正文\r\n'.repeat(200));
  await mkdir(path.join(sourceRoot, 'providers/acme.http/knowledge'));
  await mkdir(path.join(sourceRoot, 'docs'));
  await writeFile(path.join(sourceRoot, 'providers/acme.http/knowledge/routing.md'), localBytes);
  await writeFile(path.join(sourceRoot, 'docs/routing.md'), directoryBytes);
  const output = execFileSync(process.execPath, [path.join(sourceRoot, 'read-source.mjs')], { cwd: sourceRoot, encoding: 'utf8', timeout: 30_000 });
  assert(output.includes('knowledge/routing.md') && output.includes('Local original'), 'source guide entry failed with its default paths');
  const { openKnowledgeSources } = await import(pathToFileURL(path.join(sourceRoot, 'knowledge-sources.mjs')).href);
  const settings = { providerRoot: path.join(sourceRoot, 'providers/acme.http'), directoryRoot: path.join(sourceRoot, 'docs'), resolveFrom: scratch };
  const withoutReader = await openKnowledgeSources(settings);
  try {
    await assert.rejects(withoutReader.forProvider('acme.http').readDocumentPage({ capabilityId: 'route.http', knowledgeId: 'url-guide' }), { code: 'CG_READER_UNCONFIGURED' });
  } finally { await withoutReader.close(); }
  const urlBytes = Buffer.from('Real HTTP 原始正文🙂\r\n'.repeat(2000));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); response.end(urlBytes);
  });
  let sourceGraph;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}/original`;
    const file = path.join(sourceRoot, 'providers/acme.http/capabilities/route-http.json');
    const definition = JSON.parse(await readFile(file, 'utf8'));
    definition.knowledge.find((ref) => ref.knowledgeId === 'url-guide').locator.url = url;
    await writeFile(file, JSON.stringify(definition));
    const httpReader = createHttpReader(async (address, maxBytes) => {
      const response = await fetch(address); assert.equal(response.status, 200);
      const parts = []; let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes) throw new ConsumerError('CG_BUDGET_EXCEEDED', { nextAction: 'page_or_filter' });
        parts.push(chunk);
      }
      return Buffer.concat(parts);
    }, async function* (address, { chunkBytes, signal }) {
      const response = await fetch(address, { signal }); assert.equal(response.status, 200);
      for await (const chunk of response.body) for (let start = 0; start < chunk.length; start += chunkBytes) yield chunk.subarray(start, start + chunkBytes);
    });
    sourceGraph = await openKnowledgeSources({ ...settings, readers: [httpReader] });
    const provider = sourceGraph.forProvider('acme.http');
    const requiredStaticRevision = (await provider.getProvider()).staticRevision;
    const packageRoot = path.dirname(createRequire(path.join(scratch, 'package.json')).resolve('bcp-47'));
    for (const [knowledgeId, bytes, source] of [
      ['local-guide', localBytes, 'knowledge/routing.md'],
      ['external-guide', directoryBytes, 'root:docs/routing.md'],
      ['package-readme', await readFile(path.join(packageRoot, 'readme.md')), 'root:installed/readme.md'],
      ['url-guide', urlBytes, url]
    ]) {
      let cursor; let offset = 0; const parts = [];
      do {
        const page = await provider.readDocumentPage({ capabilityId: 'route.http', knowledgeId, requiredStaticRevision,
          maxBytes: cursor ? 2048 : 1024, ...(cursor ? { cursor } : {}) });
        assert.equal(page.source, source); assert.equal(page.startOffset, offset); offset = page.endOffset;
        assert.equal(page.contentId, `k:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`);
        assert.equal(page.hasMore, page.nextCursor !== undefined); parts.push(page.text); cursor = page.nextCursor;
      } while (cursor);
      assert.equal(offset, bytes.length); assert.deepEqual(Buffer.from(parts.join('')), bytes, `source guide changed ${knowledgeId}`);
    }
  } finally {
    try { await sourceGraph?.close(); } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  console.log(`document code check passed: ${tutorialChecks.checkpoints.join('/')}, ${tutorialChecks.g4Cases.join('/')}, ${sources.length} typed examples, lifecycle revision/recovery, installed Reader factory and local/directory/package/real HTTP pagination`);
} finally {
  // Only remove the exact temporary directory allocated above.
  assert.equal(path.dirname(scratch), artifactsRoot);
  assert(path.basename(scratch).startsWith('.docs-code-'));
  await rm(scratch, { recursive: true, force: true });
}
