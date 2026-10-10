import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTutorial, loadTutorial, materializeTutorial } from '../../../scripts/validation/website/lib/tutorial.mjs';
import { repositoryRoot, artifactsRoot, createTemporaryDirectory } from '../../../scripts/lib/website-paths.mjs';
import { CapabilityGraph } from '../../../dist/index.js';
import { installLocalConsumer } from '../../../scripts/validation/website/lib/consumer.mjs';

const page = (file = 'discover.mjs', code = 'console.log(1)') =>
  `\`\`\`js title="${file}"\n${code}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``;

test('tutorial fences reject unsafe, unexpected, duplicate and missing files', () => {
  for (const file of ['../outside.mjs', '/outside.mjs', 'C:/outside.mjs', '..\\outside.mjs', 'hidden.mjs']) {
    assert.throws(() => parseTutorial(page(file), ['discover.mjs']));
  }
  assert.throws(() => parseTutorial(page() + '\n' + page(), ['discover.mjs']), /duplicate/);
  assert.throws(() => parseTutorial(page(), ['discover.mjs', 'provider.json']), /missing/);
  assert.throws(() => parseTutorial(page().replace('{}', '{bad}'), ['discover.mjs']));
  assert.throws(() => parseTutorial(page().split('\n```json')[0], ['discover.mjs']), /expected/);
});

test('all checkpoints use page inputs; independent G4 has exactly four files', async () => {
  for (const checkpoint of ['G0', 'G1', 'G2', 'G3', 'G4', 'MCP']) {
    const tutorial = await loadTutorial(checkpoint);
    assert(tutorial.files.size >= 2);
    if (checkpoint === 'G0') assert.equal(tutorial.files.size, 3);
    if (checkpoint === 'G4') {
      assert.deepEqual([...tutorial.files.keys()].sort(), [
        'providers/acme-spec/PROVIDER.md', 'providers/acme-spec/capabilities/route.json',
        'providers/acme-spec/discover.mjs', 'providers/acme-spec/provider.json'
      ]);
      assert.deepEqual(tutorial.expected.catalog, ['route']);
    }
  }
});

test('materialization refuses existing inputs and leaves cleanup to caller', async () => {
  const root = await createTemporaryDirectory('.tutorial-unit-');
  try {
    const clean = path.join(root, 'clean');
    await mkdir(clean);
    const tutorial = await loadTutorial('G4');
    const result = await materializeTutorial(clean, tutorial);
    assert.equal(await readFile(result.script, 'utf8'), tutorial.files.get(tutorial.entry));
    await assert.rejects(materializeTutorial(clean, tutorial), /empty/);
    const other = path.join(root, 'other');
    await mkdir(other);
    await writeFile(path.join(other, 'hidden.capability.json'), '{}');
    await assert.rejects(materializeTutorial(other, tutorial), /empty/);
  } finally {
    assert.equal(path.dirname(root), artifactsRoot);
    assert(path.basename(root).startsWith('.tutorial-unit-'));
    await rm(root, { recursive: true, force: true });
  }
});

test('page-only regressions distinguish incomplete inputs, empty results and invalid context', async () => {
  const root = await createTemporaryDirectory('.tutorial-negative-');
  const capabilityFile = 'providers/acme-http/capabilities/route.json';
  const run = (script) => JSON.parse(execFileSync(process.execPath, [script], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe']
  }));
  const prepare = async (name, tutorial) => {
    const destination = path.join(root, name);
    await mkdir(destination);
    return materializeTutorial(destination, tutorial);
  };
  const open = (destination) => CapabilityGraph.open({
    hostAllowedProviders: ['acme.http'], integrationEnabledProviders: ['acme.http'],
    providers: [{ providerId: 'acme.http', authority: {
      kind: 'file', definitionLayout: 'directory', rootDir: path.join(destination, 'providers/acme-http')
    } }]
  });
  try {
    await installLocalConsumer(root);
    const minimal = await loadTutorial('G0');
    const missing = await prepare('missing-capability', minimal);
    await rm(path.join(missing.root, capabilityFile));
    assert.throws(() => assert.deepEqual(run(missing.script), minimal.expected),
      'a readable empty catalog must not satisfy the promised G0 result');

    const invalid = await prepare('missing-when-to-use', minimal);
    const definition = JSON.parse(minimal.files.get(capabilityFile));
    delete definition.whenToUse;
    await writeFile(path.join(invalid.root, capabilityFile), JSON.stringify(definition));
    assert.throws(() => run(invalid.script), (error) => error.status !== 0 &&
      String(error.stderr).includes('CG_VALIDATION_FAILED'));

    const complete = await prepare('complete', minimal);
    assert.throws(() => assert.deepEqual(run(complete.script), { ...minimal.expected, catalog: ['wrong'] }),
      'an incorrect expected projection must fail');
    const graph = await open(complete.root);
    try {
      const provider = graph.forProvider('acme.http');
      const children = await provider.getNeighbors('route', { kinds: ['children'] });
      assert.deepEqual(children.groups.children.items, []);
      assert.equal(children.groups.children.completeness, 'complete');
      const unknown = await provider.getCapabilities(['route.http']);
      assert.equal(unknown.results[0].ok, false);
      assert.equal(unknown.results[0].error.code, 'CG_NOT_FOUND');
    } finally { await graph.close(); }
    await assert.rejects(graph.forProvider('acme.http').listCatalog(), { code: 'CG_NO_ACTIVE_VIEW' });

    // G2/G3 must retain the tutorial's Provider identity instead of borrowing the Seed example.
    for (const checkpoint of ['G2', 'G3']) {
      const tutorial = await loadTutorial(checkpoint);
      const stage = await prepare(checkpoint, tutorial);
      const stageGraph = await open(stage.root);
      try {
        const wrongId = { providerId: 'seed.http', capabilityId: checkpoint === 'G2' ? 'route.http' : 'route.validation' };
        if (checkpoint === 'G2') {
          const result = await stageGraph.readDocuments({ selected: [wrongId] });
          assert.equal(result.results.length, 1);
          assert.equal(result.results[0].ok, false);
          assert.equal(result.results[0].error.code, 'CG_SCOPE_DENIED');
          assert.equal(result.meta.completeness, 'partial');
        } else {
          await assert.rejects(stageGraph.resolveSelection({ selected: [wrongId] }), { code: 'CG_SCOPE_DENIED' });
        }
      } finally { await stageGraph.close(); }
    }
  } finally {
    assert.equal(path.dirname(root), artifactsRoot);
    assert(path.basename(root).startsWith('.tutorial-negative-'));
    await rm(root, { recursive: true, force: true });
  }
});
