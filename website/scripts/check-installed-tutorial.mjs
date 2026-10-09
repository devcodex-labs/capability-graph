import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './lib/paths.mjs';
import { verifyTutorialSuite } from './lib/tutorial.mjs';
import { verifyLifecycleExample } from './lib/lifecycle.mjs';

const consumer = await realpath(process.argv[2]);
assert(!consumer.startsWith(repositoryRoot + path.sep) && consumer !== repositoryRoot,
  'registry consumer must live outside the source repository');
const expectedVersion = process.argv[3];
assert(expectedVersion, 'expected package version is required');
const installedRoot = path.join(consumer, 'node_modules', '@devcodex', 'capability-graph');
const installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
assert.equal(installed.version, expectedVersion, 'the unversioned install did not resolve to the release version');

const tutorialChecks = await verifyTutorialSuite(consumer);
await verifyLifecycleExample(consumer);
const resolved = execFileSync(process.execPath, [
  '--input-type=module',
  '--eval',
  "console.log(import.meta.resolve('@devcodex/capability-graph'))"
], { cwd: consumer, encoding: 'utf8' }).trim();
assert(resolved.startsWith(pathToFileURL(installedRoot).href), 'tutorial did not use the installed package');
console.log(`unversioned registry consumer passed: ${installed.name}@${installed.version}, ${tutorialChecks.checkpoints.join('/')}, ${tutorialChecks.g4Cases.join('/')}, lifecycle revision/recovery`);
