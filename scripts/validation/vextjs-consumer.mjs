import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, cp, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createTemporaryDirectory, repositoryRoot } from '../lib/artifact-paths.mjs';
import { assertCurrentBuild } from '../lib/build-state.mjs';
import { verifyVextSource } from '../../examples/vextjs/source-provenance.mjs';

// Opt-in: installs real tarballs into a fresh external project. Never uses a node_modules symlink.
const execute = promisify(execFile);
const [sourceArg, sourceIdentity, ...flags] = process.argv.slice(2);
if (!sourceArg || !/^[a-f0-9]{40}$/.test(sourceIdentity ?? '') || flags.some((flag) => flag !== '--https')) {
  throw new Error('Usage: node scripts/validation/vextjs-consumer.mjs <built-fixed-vext-source> <full-commit> [--https]');
}
const sourceRoot = await realpath(sourceArg);
await assertCurrentBuild(repositoryRoot);
const source = await verifyVextSource({ sourceRoot, frameworkRoot: sourceRoot, sourceIdentity });
const runRoot = await createTemporaryDirectory('vextjs-e2e-');
const appRoot = path.join(runRoot, 'app');
for (const name of ['app', 'archives', 'logs', 'data', 'reports', 'cache/tmp', 'cache/npm', 'scratch']) {
  await mkdir(path.join(runRoot, name), { recursive: true });
}
const env = { ...process.env, CG_ARTIFACTS_DIR: path.join(runRoot, 'scratch'),
  TMPDIR: path.join(runRoot, 'cache/tmp'), TMP: path.join(runRoot, 'cache/tmp'), TEMP: path.join(runRoot, 'cache/tmp'),
  NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || path.join(runRoot, 'cache/npm'), VEXT_BUILT: '', VEXT_MODE: '' };
let commandNumber = 0;
async function command(file, args, cwd = runRoot, timeout = 120000) {
  const log = path.join(runRoot, 'logs', `${String(++commandNumber).padStart(2, '0')}-${path.basename(file)}.log`);
  try {
    const result = await execute(file, args, { cwd, env, timeout, maxBuffer: 8_388_608, windowsHide: true });
    await writeFile(log, result.stdout + result.stderr); return result.stdout.trim();
  } catch (error) {
    await writeFile(log, (error.stdout ?? '') + (error.stderr ?? '') + String(error));
    throw new Error(`Command failed; see ${log}`, { cause: error });
  }
}
const npmCli = process.env.npm_execpath;
const npm = (args, cwd) => npmCli ? command(process.execPath, [npmCli, ...args], cwd)
  : command(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
const hash = (body) => createHash('sha256').update(body).digest('hex');
let container;
const report = { status: 'running', runRoot, appRoot, source, startedAt: new Date().toISOString(), stages: {} };
const reportFile = path.join(runRoot, 'reports', 'verification.json');
console.log(`External verification project: ${appRoot}`);
try {
  const corePack = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(runRoot, 'archives')], repositoryRoot))[0];
  const vextPack = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(runRoot, 'archives')], sourceRoot))[0];
  const coreArchive = path.join(runRoot, 'archives', corePack.filename);
  const vextArchive = path.join(runRoot, 'archives', vextPack.filename);
  for (const [archive, packed] of [[coreArchive, corePack], [vextArchive, vextPack]]) {
    const bytes = await readFile(archive);
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, packed.integrity);
  }
  const coreManifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(sourceRoot, 'package-lock.json'), 'utf8'));
  const monsqlizeVersion = lock.packages['node_modules/monsqlize'].version;
  await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'capability-graph-vextjs-consumer', private: true, type: 'module',
    scripts: { start: 'node start.mjs', verify: 'node verify.mjs ../data/context.json' },
    dependencies: { '@devcodex/capability-graph': `file:${coreArchive}`, vextjs: `file:${vextArchive}`, monsqlize: monsqlizeVersion } }, null, 2) + '\n');
  console.log('Installing current Core and fixed VextJS tarballs into fresh node_modules…');
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], appRoot);
  // Copy maintained source references, with provenance. They resolve Core from this consumer's installed package.
  const copied = [];
  for (const [from, to] of [
    ['scripts/validation/lib/vextjs-consumer-checks.mjs', 'verify.mjs'],
    ['dist-test/examples/seed-runtime/text-retrieval.js', 'adapters/text-retrieval.js'],
    ['dist-test/examples/seed-runtime/knowledge-reader.js', 'adapters/knowledge-reader.js'],
  ]) {
    const original = await readFile(path.join(repositoryRoot, from));
    await mkdir(path.dirname(path.join(appRoot, to)), { recursive: true });
    await cp(path.join(repositoryRoot, from), path.join(appRoot, to));
    copied.push({ source: from, destination: to, sha256: hash(original), role: 'maintained verification/reference implementation; integration-authored' });
  }
  report.stages.installation = { core: { version: coreManifest.version, archiveSha256: hash(await readFile(coreArchive)), integrity: corePack.integrity },
    vext: { commit: source.commit, archiveSha256: hash(await readFile(vextArchive)), integrity: vextPack.integrity }, monsqlizeVersion, copied,
    consumerLockSha256: hash(await readFile(path.join(appRoot, 'package-lock.json'))) };
  // Inspect and pin the local image by immutable digest. The report records the actual image used.
  const images = JSON.parse(await command('docker', ['image', 'inspect', 'mongo:8.0']));
  const image = images[0].RepoDigests.find((digest) => digest.startsWith('mongo@sha256:'));
  assert(image, 'A digest-verified mongo:8.0 image must be installed before this opt-in check');
  const name = `cg-vext-${randomUUID()}`;
  // Docker's automatically allocated HostPort can change after restart. Reserve an explicit local port.
  const portProbe = createServer();
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
  const mongoPort = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
  container = await command('docker', ['run', '--detach', '--name', name, '--label', 'capability-graph.verification=vextjs-consumer',
    '--publish', `127.0.0.1:${mongoPort}:27017`, image, 'mongod', '--bind_ip_all']);
  const state = JSON.parse(await command('docker', ['inspect', container]))[0];
  const binding = state.NetworkSettings.Ports['27017/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  assert.equal(Number(binding.HostPort), mongoPort);
  const context = { repositoryRoot, sourceRoot, sourceIdentity, runRoot, appRoot, includeHttps: flags.includes('--https'),
    mongoContainer: container, mongoImage: image, mongoUri: `mongodb://127.0.0.1:${binding.HostPort}/cg_consumer?serverSelectionTimeoutMS=1000&connectTimeoutMS=1000` };
  await writeFile(path.join(runRoot, 'data/context.json'), JSON.stringify(context, null, 2) + '\n');
  await writeFile(path.join(appRoot, 'README.md'), '# 独立 VextJS 消费者验证项目\n\n由 Capability Graph 的受维护验证入口生成；业务样例代码为集成作者编写。\n知识来源与原始哈希见 ../reports/verification.json，原生导出见 providers/vextjs/knowledge/catalog.json。\n\n从源码仓库重新运行 scripts/validation/vextjs-consumer.mjs 会创建全新批次，不复用此项目。\n本项目 npm run verify 是宿主 runner 为新项目执行的单次完整验收；依赖 context.json 中本批次拥有的 MongoDB 容器，结束时容器及匿名卷由 runner 删除。\n\n保留的业务项目可以独立运行：先提供自己拥有的 MongoDB，设置 VEXT_CONSUMER_MONGO_URI 和可选 VEXT_CONSUMER_PORT，再执行 npm start；停止应用触发正常资源清理。\n');
  console.log('Verifying installed public APIs, real TCP business requests and failure recovery…');
  await command(process.execPath, ['verify.mjs', path.join(runRoot, 'data/context.json')], appRoot, 240000);
  report.stages.consumer = JSON.parse(await readFile(path.join(runRoot, 'reports/consumer.json'), 'utf8'));
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error); throw error;
} finally {
  try {
    if (container) {
      try { await command('docker', ['logs', container]); }
      finally { await command('docker', ['rm', '--force', '--volumes', container]); }
      report.containerRemoved = true;
    }
  } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  try { report.stages.consumer = JSON.parse(await readFile(path.join(runRoot, 'reports/consumer.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') { report.status = 'failed'; report.reportError = String(error); process.exitCode = 1; } }
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`Verification ${report.status}; retained report: ${reportFile}`);
}
