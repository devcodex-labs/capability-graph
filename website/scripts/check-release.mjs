import { access, appendFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
const websiteManifest = JSON.parse(await readFile(path.join(websiteRoot, 'package.json'), 'utf8'));
const websiteLock = JSON.parse(await readFile(path.join(websiteRoot, 'package-lock.json'), 'utf8'));
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
const isManualResume = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
assert(stableVersion.test(manifest.version), `release package version must be stable SemVer: ${manifest.version}`);
assert(releaseTag === `v${manifest.version}`, `tag ${releaseTag ?? '<missing>'} must equal v${manifest.version}`);
if (process.env.GITHUB_REF_TYPE) {
  assert(process.env.GITHUB_REF_TYPE === 'tag' || isManualResume, 'release workflow must run from a tag or an explicit manual resume');
}
assert(manifest.name === '@devcodex/capability-graph', 'unexpected root package name');
for (const [name, value] of [
  ['root lock', lock.version],
  ['root lock package', lock.packages?.['']?.version],
  ['website package', websiteManifest.version],
  ['website lock', websiteLock.version],
  ['website lock package', websiteLock.packages?.['']?.version]
]) assert(value === manifest.version, `${name} ${value} must match ${manifest.version}`);
await access(path.join(repositoryRoot, 'changelogs', `${manifest.version}.md`));
const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');
assert(readme.includes(`changelogs/${manifest.version}.md`), 'README must link the release changelog');

const releaseId = `capability-graph-${manifest.version}`;
const releaseCommit = process.env.RELEASE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trim();
assert(/^[0-9a-f]{40}$/i.test(releaseCommit), 'release commit must be a full Git SHA');

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `release_id=${releaseId}`,
    `release_tag=${releaseTag}`,
    `release_commit=${releaseCommit}`,
    `package_version=${manifest.version}`,
    ''
  ].join('\n'), 'utf8');
}
console.log(`release contract passed: ${releaseTag} -> ${manifest.name}@${manifest.version} (${releaseCommit})`);
