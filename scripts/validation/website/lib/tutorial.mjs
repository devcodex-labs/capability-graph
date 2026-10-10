import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { websiteRoot } from '../../../lib/website-paths.mjs';

const contracts = {
  G0: ['provider.json', 'capabilities/route.json', 'discover.mjs'],
  G1: ['capabilities/route-http.json', 'discover.mjs'],
  G2: ['capabilities/route-http.json', 'knowledge/routing.md', 'discover.mjs'],
  G3: ['capabilities/route-validation.json', 'capabilities/schema-request.json', 'discover.mjs'],
  G4: ['provider.json', 'PROVIDER.md', 'discover.mjs'],
  MCP: ['server.mjs', 'client.mjs']
};

/** Read only explicit tutorial fences. Page text is authoritative; fixtures are never inputs. */
export function parseTutorial(source, requiredFiles) {
  const files = new Map();
  let expected;
  const fences = [...source.matchAll(/```(json|js|md)(?: title="([^"]+)")?\r?\n([\s\S]*?)\r?\n```/g)];
  for (const [, language, name, body] of fences) {
    if (!name) {
      if (language === 'json') {
        assert.equal(expected, undefined, 'duplicate expected output');
        expected = JSON.parse(body);
      }
      continue;
    }
    assert(!name.includes('\\') && !path.posix.isAbsolute(name) &&
      !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..'), 'unsafe tutorial path');
    assert(requiredFiles.includes(name), `unexpected tutorial file: ${name}`);
    assert(!files.has(name), `duplicate tutorial file: ${name}`);
    if (name.endsWith('.json')) {
      assert.equal(language, 'json', 'definition must use a JSON fence');
      JSON.parse(body);
    } else {
      assert.equal(language, name.endsWith('.mjs') ? 'js' : 'md', 'file language mismatch');
    }
    files.set(name, `${body}\n`);
  }
  for (const name of requiredFiles) assert(files.has(name), `missing tutorial file: ${name}`);
  assert.notEqual(expected, undefined, 'missing expected output');
  return { files, expected };
}

/** Assemble only documented checkpoints. G3/G4 start from G0, never the advanced fixture. */
export async function loadTutorial(checkpoint, docsRoot = path.join(websiteRoot, 'docs')) {
  assert(Object.hasOwn(contracts, checkpoint), 'unknown tutorial checkpoint');
  const read = (page) => readFile(path.join(docsRoot, `${page}.mdx`), 'utf8');
  if (checkpoint === 'MCP') {
    return { ...parseTutorial(await read('integrations/provider-owned-mcp'), contracts.MCP),
      entry: 'client.mjs', checkpoint };
  }
  const minimal = parseTutorial(await read('getting-started/first-provider'), contracts.G0);
  if (checkpoint === 'G0') return { ...minimal, files: new Map([...minimal.files].map(([name, body]) =>
    [name === 'discover.mjs' ? name : `providers/acme-http/${name}`, body])), entry: 'discover.mjs', checkpoint };
  const source = await read('guides/progressive-discovery');
  const stage = (id) => {
    const start = source.indexOf(`## ${id}. `);
    assert(start >= 0, `missing checkpoint ${id}`);
    const end = source.indexOf('\n## ', start + 1);
    return parseTutorial(source.slice(start, end < 0 ? undefined : end), contracts[id]);
  };
  const ids = checkpoint === 'G2' ? ['G1', 'G2'] : [checkpoint];
  let expected = minimal.expected;
  for (const id of ids) {
    const step = stage(id);
    for (const [name, value] of step.files) minimal.files.set(name, value);
    expected = step.expected;
  }
  if (checkpoint === 'G4') {
    return { files: new Map([...minimal.files].map(([name, body]) => [`providers/acme-spec/${name}`, body])),
      expected, entry: 'providers/acme-spec/discover.mjs', checkpoint };
  }
  return { files: new Map([...minimal.files].map(([name, body]) =>
    [name === 'discover.mjs' ? name : `providers/acme-http/${name}`, body])),
    expected, entry: 'discover.mjs', checkpoint };
}

/** Write into an empty directory allocated by the caller. Caller owns package setup and cleanup. */
export async function materializeTutorial(destination, tutorial) {
  const root = await realpath(destination);
  assert.equal((await readdir(root)).length, 0, 'tutorial destination must be empty; no hidden fixture inputs');
  const files = tutorial.files;
  for (const [name, body] of files) {
    assert(!name.includes('\\') && !path.posix.isAbsolute(name) &&
      !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..'), 'unsafe materialization path');
    const target = path.resolve(root, name);
    assert(target.startsWith(root + path.sep), 'tutorial file escaped allocated root');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, 'utf8');
  }
  return { ...tutorial, files, root, script: path.join(root, tutorial.entry) };
}

/** Compare only after materialization; a fixture must never supply a missing page file. */
export async function compareFixture(tutorial, fixtureRoot) {
  for (const [name, body] of tutorial.files) {
    const fixture = await readFile(path.join(fixtureRoot, name), 'utf8');
    assert.equal(fixture.replaceAll('\r\n', '\n'), body.replaceAll('\r\n', '\n'),
      `fixture drift: ${name}`);
  }
}

/** Execute the same page-only suite under either repository or installed-package ancestry. */
export async function verifyTutorialSuite(consumer) {
  const parent = await realpath(consumer);
  const root = await mkdtemp(path.join(parent, '.tutorial-suite-'));
  const run = (script) => JSON.parse(execFileSync(process.execPath, [script], {
    cwd: path.dirname(script), encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe']
  }));
  try {
    for (const checkpoint of ['G0', 'G1', 'G2', 'G3', 'G4']) {
      const destination = path.join(root, checkpoint);
      await mkdir(destination);
      const tutorial = await loadTutorial(checkpoint);
      const materialized = await materializeTutorial(destination, tutorial);
      assert.deepEqual(run(materialized.script), tutorial.expected, `${checkpoint} page output drift`);
    }
    const source = await readFile(path.join(websiteRoot, 'docs', 'guides', 'progressive-discovery.mdx'), 'utf8');
    const start = source.indexOf('## G4. ');
    const end = source.indexOf('\n## ', start + 1);
    const g4 = source.slice(start, end < 0 ? undefined : end);
    for (const name of ['PROVIDER.md', 'discover.mjs']) {
      const missing = g4.replace(new RegExp('```(?:md|js) title="' + name.replaceAll('.', '\\.') + '"\\r?\\n[\\s\\S]*?\\r?\\n```'), '');
      assert.throws(() => parseTutorial(missing, contracts.G4), /missing tutorial file/);
    }
    const missingRoot = path.join(root, 'G4-missing-document');
    await mkdir(missingRoot);
    const missing = await materializeTutorial(missingRoot, await loadTutorial('G4'));
    await rm(path.join(missingRoot, 'providers/acme-spec/PROVIDER.md'));
    assert.throws(() => run(missing.script), (error) => error.status !== 0 &&
      String(error.stderr).includes('CG_SOURCE_UNREADABLE'), 'missing Specification must actually fail in Core');

    const contaminatedRoot = path.join(root, 'G4-extra-capability');
    await mkdir(contaminatedRoot);
    const contaminated = await materializeTutorial(contaminatedRoot, await loadTutorial('G4'));
    const g1 = await loadTutorial('G1');
    await writeFile(path.join(contaminatedRoot, 'providers/acme-spec/capabilities/route-http.json'),
      g1.files.get('providers/acme-http/capabilities/route-http.json'), 'utf8');
    const polluted = run(contaminated.script);
    assert.throws(() => assert.deepEqual(polluted.catalog, ['route']), 'hidden advanced inputs must not satisfy G4');
    return { checkpoints: ['G0', 'G1', 'G2', 'G3', 'G4'], g4Cases: ['G4-01', 'G4-02', 'G4-03', 'G4-04'] };
  } finally {
    assert.equal(path.dirname(root), parent);
    assert(path.basename(root).startsWith('.tutorial-suite-'));
    await rm(root, { recursive: true, force: true });
  }
}
