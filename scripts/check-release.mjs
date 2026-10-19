import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function validateRelease(pkg, lock, {ci = false, dryRun = false, refType, tag} = {}) {
  if (pkg.name !== '@devcodex/capability-graph' || !stableVersion.test(pkg.version)) throw new Error('A stable Capability Graph version is required.');
  if (pkg.private === true || pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') throw new Error('Publication must target the public npm registry.');
  if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.name !== pkg.name || lock.packages?.['']?.version !== pkg.version) throw new Error('Package and lock versions differ.');
  if (ci && !dryRun && refType !== 'tag') throw new Error('Publication requires a version tag.');
  if (refType === 'tag' && tag !== 'v' + pkg.version) throw new Error('Tag and package version differ.');
}
export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line === '## ' + version);
  if (start < 0) throw new Error('Missing current release notes in CHANGELOG.md.');
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const notes = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
  if (!notes) throw new Error('Current release notes are empty.');
  return notes + '\n';
}
const root = fileURLToPath(new URL('../', import.meta.url));
export async function checkRelease(options = {}) {
  const readJSON = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
  const pkg = await readJSON('package.json');
  validateRelease(pkg, await readJSON('package-lock.json'), options);
  for (const name of ['plugin/plugin.json', 'plugin/.codex-plugin/plugin.json', 'website/package.json', 'website/package-lock.json']) {
    if ((await readJSON(name)).version !== pkg.version) throw new Error('Version drift: ' + name);
  }
  const websiteLock = await readJSON('website/package-lock.json');
  if (websiteLock.packages?.['']?.version !== pkg.version) throw new Error('Website lock root version differs.');
  for (const [file, identity] of [['src/mcp/index.ts', 'capability-graph'], ['src/cli/diagnose.ts', 'capability-graph-diagnostic']]) {
    if (!(await fs.readFile(path.join(root, file), 'utf8')).includes(`name: '${identity}', version: '${pkg.version}'`)) throw new Error('Runtime identity version differs: ' + file);
  }
  for (const name of ['website/rspress.config.ts', 'website/scripts/run.mjs', 'website/content/index.mdx']) {
    if (!(await fs.readFile(path.join(root, name), 'utf8')).includes('Capability Graph v' + pkg.version)) throw new Error('Site version differs: ' + name);
  }
  const notes = releaseNotes(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), pkg.version);
  if (options.ci) {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], {cwd: root});
    if (result.error || result.status !== 0) throw new Error('The release commit must belong to origin/main.');
  }
  return {pkg, notes};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => !['--notes', '--dry-run'].includes(arg))) throw new Error('Usage: check-release.mjs [--notes] [--dry-run]');
    const result = await checkRelease({ci: process.env.GITHUB_ACTIONS === 'true', dryRun: process.argv.includes('--dry-run') || process.env.CG_RELEASE_DRY_RUN === 'true', refType: process.env.GITHUB_REF_TYPE, tag: process.env.GITHUB_REF_NAME});
    process.stdout.write(process.argv.includes('--notes') ? result.notes : `Verified ${result.pkg.name}@${result.pkg.version}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
