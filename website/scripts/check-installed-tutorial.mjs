import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { websiteRoot } from './lib/paths.mjs';

const consumer = await realpath(process.argv[2]);
const expectedVersion = process.argv[3];
assert(expectedVersion, 'expected package version is required');
const installedRoot = path.join(consumer, 'node_modules', '@devcodex', 'capability-graph');
const installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
assert.equal(installed.version, expectedVersion, 'the unversioned install did not resolve to the release version');

const tutorial = await readFile(path.join(websiteRoot, 'docs', 'getting-started', 'first-provider.mdx'), 'utf8');
const fences = [...tutorial.matchAll(/```(json|js)(?: title="([^"]+)")?\r?\n([\s\S]*?)\r?\n```/g)];
const script = fences.find(([, language, file]) => language === 'js' && file === 'discover.mjs');
const expected = fences.find(([, language, file]) => language === 'json' && !file);
assert(script && expected, 'First Provider must contain discover.mjs and its expected result');

const providerRoot = path.join(consumer, 'providers', 'acme-http');
await cp(path.join(websiteRoot, 'fixtures', 'first-provider'), providerRoot, { recursive: true });
await writeFile(path.join(consumer, 'discover.mjs'), `${script[3]}\n`, 'utf8');
const output = JSON.parse(execFileSync(process.execPath, ['discover.mjs'], {
  cwd: consumer,
  encoding: 'utf8',
  timeout: 30_000
}));
const expectedProjection = JSON.parse(expected[3]);
const { text, ...projection } = output;
assert.deepEqual(projection, expectedProjection, 'installed package result differs from the documented result');
assert.equal(text, await readFile(path.join(providerRoot, 'knowledge', 'routing.md'), 'utf8'));
const resolved = execFileSync(process.execPath, [
  '--input-type=module',
  '--eval',
  "console.log(import.meta.resolve('@devcodex/capability-graph'))"
], { cwd: consumer, encoding: 'utf8' }).trim();
assert(resolved.startsWith(pathToFileURL(installedRoot).href), 'tutorial did not use the installed package');
console.log(`unversioned registry consumer passed: ${installed.name}@${installed.version}, catalog/detail/relations/knowledge`);
