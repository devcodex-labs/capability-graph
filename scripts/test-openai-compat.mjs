import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// SDK 7 is a separate development consumer; Node 20 stays on the SDK 6 baseline.
const [major, minor] = process.versions.node.split('.').map(Number);
assert(major > 22 || major === 22 && minor >= 12, 'SDK 7 compatibility tests require Node >=22.12.0; use npm test for Node 20.19+.');
const npm = process.env.npm_execpath;
assert(npm, 'Run this check with npm run test:openai:compat so npm_execpath is available.');
const source = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const base = path.resolve(process.env.CG_ARTIFACTS_DIR ?? path.join(source, '../capability-graph-artifacts'));
await fs.mkdir(base, {recursive: true});
const relative = path.relative(source, await fs.realpath(base));
assert(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Compatibility artifacts must be outside source.');
const root = await fs.mkdtemp(path.join(base, 'openai7-'));
const candidate = path.join(root, 'source');
await fs.mkdir(candidate);
// Copy current working files, including uncommitted changes; never substitute a HEAD archive.
for (const name of ['src', 'test', 'plugin', 'tsconfig.json', 'tsconfig.test.json', 'package.json', 'package-lock.json']) {
  await fs.cp(path.join(source, name), path.join(candidate, name), {recursive: true});
}
await fs.mkdir(path.join(candidate, 'scripts'));
for (const name of ['build.mjs', 'test.mjs']) await fs.copyFile(path.join(source, 'scripts', name), path.join(candidate, 'scripts', name));
const manifest = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
manifest.devDependencies.openai = '7.39.0';
assert.equal(manifest.devDependencies['@types/node'], '20.19.0');
await fs.writeFile(path.join(candidate, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const env = {...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  CG_BUILD_DIR: path.join(root, 'build'), CG_TEST_DIR: path.join(root, 'fixtures'), CG_ARTIFACTS_DIR: path.join(root, 'artifacts')};
const commands = [];

/** Run npm with this exact Node executable; any failed install, tree or test fails the check. */
function run(args) {
  const result = spawnSync(process.execPath, [npm, ...args], {cwd: candidate, env, stdio: 'inherit', timeout: 300000});
  commands.push({args, exitCode: result.status, error: result.error?.message});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `SDK 7 check failed: npm ${args.join(' ')}`);
}
let status = 'FAIL';
try {
  // Update only the isolated manifest/lock, then prove it is a valid strict cold install.
  run(['install', '--package-lock-only', '--ignore-scripts', '--engine-strict', '--no-audit', '--no-fund']);
  run(['ci', '--engine-strict', '--no-audit', '--no-fund']);
  run(['ls', 'openai', '@types/node']);
  for (const [name, version] of [['openai', '7.39.0'], ['@types/node', '20.19.0']]) {
    assert.equal(JSON.parse(await fs.readFile(path.join(candidate, 'node_modules', name, 'package.json'), 'utf8')).version, version);
  }
  run(['test']);
  status = 'PASS';
} finally {
  const evidence = path.join(root, 'evidence.json');
  await fs.writeFile(evidence, JSON.stringify({status, node: process.version, platform: process.platform, candidate, sdk: '7.39.0', nodeTypes: '20.19.0', commands}, null, 2) + '\n');
  console.log(JSON.stringify({status, evidence}));
}
