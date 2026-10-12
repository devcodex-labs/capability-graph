import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, rm, stat } from 'node:fs/promises';
import { createTemporaryDirectory, artifactsRoot } from './lib/artifact-paths.mjs';

const npm = process.env.CG_NPM_CLI ?? process.env.npm_execpath;
assert(npm, 'Run with npm run test:install');
const temporary = await createTemporaryDirectory('capability-graph-install-');
const node = process.execPath, version = execFileSync(node, [npm, '--version'], { encoding: 'utf8' }).trim();
const run = (args, cwd, env) => execFileSync(node, args, { cwd, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
async function absent(file) { await assert.rejects(stat(file), { code: 'ENOENT' }); }
async function account(name) {
  const root = path.join(temporary, name), home = path.join(root, 'home'), cwd = path.join(root, 'work'); await mkdir(home, { recursive: true }); await mkdir(cwd);
  const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(home, '.codex') };
  assert.equal(run(['--input-type=module', '-e', "import os from 'node:os';process.stdout.write(os.homedir())"], cwd, env), home, 'isolate account before running any install script');
  return { root, home, cwd, env, prefix: path.join(root, 'prefix'), config: path.join(home, '.capability-graph', 'config.json'), result: path.join(home, '.capability-graph', 'install-result.json') };
}
try {
  const [packed] = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporary], process.cwd(), process.env));
  assert(packed.files.some(file => file.path === 'scripts/postinstall.mjs'));
  const tarball = path.join(temporary, packed.filename);
  const local = await account('local'); await writeFile(path.join(local.cwd, 'package.json'), '{"name":"local-consumer","private":true}');
  run([npm, 'install', '--prefer-offline', '--no-audit', '--no-fund', tarball], local.cwd, local.env); await absent(local.config);
  const ignored = await account('ignored'); run([npm, 'install', '--global', '--prefix', ignored.prefix, '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', tarball], ignored.cwd, ignored.env); await absent(ignored.config);
  const dependency = await account('dependency'), wrapper = path.join(dependency.cwd, 'wrapper'); await mkdir(wrapper);
  await writeFile(path.join(wrapper, 'package.json'), JSON.stringify({ name: 'cg-global-dependency-host', version: '1.0.0', dependencies: { '@devcodex/capability-graph': `file:${tarball}` } }));
  const [wrapperPack] = JSON.parse(run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', dependency.cwd], wrapper, dependency.env));
  run([npm, 'install', '--global', '--prefix', dependency.prefix, '--prefer-offline', '--no-audit', '--no-fund', path.join(dependency.cwd, wrapperPack.filename)], dependency.cwd, dependency.env);
  await absent(dependency.config);
  const direct = await account('direct');
  run([npm, 'install', '--global', '--prefix', direct.prefix, '--prefer-offline', '--no-audit', '--no-fund', tarball], direct.cwd, direct.env);
  const result = JSON.parse(await readFile(direct.result, 'utf8'));
  assert.equal(result.installed.state, 'pass'); assert.equal(result.configRegistered.state, 'pass', JSON.stringify(result));
  assert.equal(result.localProtocolVerified.state, 'pass', JSON.stringify(result)); assert.equal(result.clientConnected.state, 'unknown');
  assert.deepEqual(JSON.parse(await readFile(direct.config, 'utf8')).providers, []);
  const installed = path.join(direct.prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', '@devcodex', 'capability-graph');
  const cli = path.join(installed, 'dist', 'cli', 'main.js');
  const status = JSON.parse(run([cli, 'codex', 'status', '--config', direct.config, '--json'], direct.cwd, direct.env));
  assert.equal(status.configRegistered.state, 'pass'); assert.equal(status.localProtocolVerified.state, 'not_run'); assert.equal(status.clientConnected.state, 'unknown');
  const original = await readFile(path.join(direct.home, '.codex', 'config.toml'), 'utf8');
  run([npm, 'install', '--global', '--prefix', direct.prefix, '--prefer-offline', '--no-audit', '--no-fund', tarball], direct.cwd, direct.env);
  assert.equal(await readFile(path.join(direct.home, '.codex', 'config.toml'), 'utf8'), original, 'unchanged owned upgrade is idempotent');
  run([cli, 'codex', 'unregister', '--config', direct.config], direct.cwd, direct.env);
  assert(!((await readFile(path.join(direct.home, '.codex', 'config.toml'), 'utf8')).includes('[mcp_servers.capability_graph]')));
  run([npm, 'uninstall', '--global', '--prefix', direct.prefix, '@devcodex/capability-graph'], direct.cwd, direct.env);
  assert.deepEqual(JSON.parse(await readFile(direct.config, 'utf8')).providers, [], 'uninstall retains user configuration');
  const conflict = await account('conflict'); await mkdir(path.join(conflict.home, '.codex'));
  const foreign = '# keep\r\n[mcp_servers.capability_graph]\r\ncommand="external"\r\n'; await writeFile(path.join(conflict.home, '.codex', 'config.toml'), foreign);
  run([npm, 'install', '--global', '--prefix', conflict.prefix, '--prefer-offline', '--no-audit', '--no-fund', tarball], conflict.cwd, conflict.env);
  const failed = JSON.parse(await readFile(conflict.result, 'utf8')); assert.equal(failed.installed.state, 'pass'); assert.equal(failed.configRegistered.state, 'fail');
  assert.equal(await readFile(path.join(conflict.home, '.codex', 'config.toml'), 'utf8'), foreign);
  const unwritable = await account('failure-report-unwritable');
  await mkdir(path.dirname(unwritable.result), { recursive: true }); await mkdir(unwritable.result);
  assert.throws(() => run([npm, 'install', '--global', '--prefix', unwritable.prefix, '--prefer-offline', '--no-audit', '--no-fund', tarball], unwritable.cwd, unwritable.env),
    error => error.status !== 0 && String(error.stderr).includes('安装结果无法持久保存'), 'a non-file result target must fail the actual npm lifecycle');
  console.log(JSON.stringify({ state: 'pass', platform: process.platform, node: process.version, npm: version,
    cases: ['local-no-registration', 'ignore-scripts', 'global-dependency-no-registration', 'direct-global-auto-probe', 'owned-upgrade', 'unregister-uninstall-retains-config', 'foreign-conflict-preserves-cli', 'failure-report-cannot-persist-npm-nonzero'] }));
} finally {
  assert.equal(path.dirname(temporary), artifactsRoot); assert.equal(await realpath(temporary), temporary);
  await rm(temporary, { recursive: true, force: true }); await absent(temporary);
}
