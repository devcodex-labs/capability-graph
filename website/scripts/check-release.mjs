import { appendFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { repositoryRoot, websiteRoot } from './lib/paths.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const release = JSON.parse(await readFile(path.join(websiteRoot, 'release.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
assert(release.schemaVersion === 'CapabilityGraphReleaseV1', 'unsupported release schema');
assert(/^[a-z0-9][a-z0-9.-]{2,127}$/.test(release.releaseId), 'releaseId is invalid');
assert(['publish', 'verify'].includes(release.packageMode), 'packageMode must be publish or verify');
assert(release.packageVersion === manifest.version, 'release packageVersion must match the root package');
assert(manifest.name === '@devcodex-labs/capability-graph', 'unexpected root package name');

if (process.env.GITHUB_EVENT_NAME === 'push') {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).split(/\r?\n/);
  assert(changed.includes('website/release.json'), 'push release requires release.json to change in this commit');
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `release_id=${release.releaseId}`,
    `package_version=${release.packageVersion}`,
    `package_mode=${release.packageMode}`,
    ''
  ].join('\n'), 'utf8');
}
console.log(`release contract passed: ${release.releaseId} ${release.packageMode} ${release.packageVersion}`);
