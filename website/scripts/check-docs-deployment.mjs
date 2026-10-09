import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from './lib/paths.mjs';
import { assertDocsBaseline } from './lib/deployment-contract.mjs';

const git = (args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'invalid supported package version');
const releaseTag = `v${manifest.version}`;
const releaseCommit = git(['rev-parse', `refs/tags/${releaseTag}^{commit}`]);
const documentationCommit = git(['rev-parse', 'HEAD']);
const baseline = JSON.parse(git(['show', `${releaseTag}:package.json`]));
const registryVersion = JSON.parse(execFileSync('npm', ['view', manifest.name, 'dist-tags.latest', '--json', '--prefer-online'], {
  cwd: repositoryRoot, encoding: 'utf8'
}));
// Tests and website may change without a package release; shipped Core/build inputs may not.
const diff = spawnSync('git', ['diff', '--quiet', releaseTag, 'HEAD', '--',
  'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.consumer.json'], { cwd: repositoryRoot });
assert([0, 1].includes(diff.status), 'cannot compare published Core baseline');
assertDocsBaseline({ version: manifest.version, registryVersion, tagVersion: baseline.version,
  coreChanged: diff.status !== 0, documentationCommit, mainCommit: git(['rev-parse', 'origin/main']) });
if (process.env.DOCS_COMMIT) assert.equal(process.env.DOCS_COMMIT, documentationCommit, 'frozen documentation commit changed');
if (process.env.RELEASE_COMMIT) assert.equal(process.env.RELEASE_COMMIT, releaseCommit, 'frozen package commit changed');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  `package_version=${manifest.version}\nrelease_tag=${releaseTag}\nrelease_commit=${releaseCommit}\ndocumentation_commit=${documentationCommit}\n`);
console.log(`documentation baseline passed: ${documentationCommit} supports ${releaseTag} (${releaseCommit})`);
