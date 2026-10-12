import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createTemporaryDirectory, repositoryRoot } from '../lib/artifact-paths.mjs';
import { assertCurrentBuild } from '../lib/build-state.mjs';
import { verifyVextSource } from '../../examples/vextjs/source-provenance.mjs';
import { validateProviderSources } from './provider-sources.mjs';
import { validateVextDocumentation } from './vextjs-documentation.mjs';
import { validateVextjs } from './vextjs.mjs';

// Install actual tarballs in a fresh external project; all graph queries use its installed public class.
const execute = promisify(execFile);
const [sourceArg, sourceIdentity, ...flags] = process.argv.slice(2);
if (!sourceArg || !/^[a-f0-9]{40}$/.test(sourceIdentity ?? '') || flags.some((flag) => flag !== '--https')) {
  throw new Error('Usage: vextjs-consumer.mjs <built-fixed-vext-source> <full-commit> [--https]');
}
const sourceRoot = await realpath(sourceArg); await assertCurrentBuild(repositoryRoot);
const source = await verifyVextSource({ sourceRoot, frameworkRoot: sourceRoot, sourceIdentity });
const runRoot = await createTemporaryDirectory('vextjs-e2e-'); const appRoot = path.join(runRoot, 'app');
for (const name of ['app', 'archives', 'logs', 'reports', 'cache/npm']) await mkdir(path.join(runRoot, name), { recursive: true });
const env = { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || path.join(runRoot, 'cache/npm') };
let number = 0;
async function command(file, args, cwd) {
  const log = path.join(runRoot, 'logs', `${++number}-${path.basename(file)}.log`);
  try { const result = await execute(file, args, { cwd, env, timeout: 120000, maxBuffer: 8_388_608, windowsHide: true });
    await writeFile(log, result.stdout + result.stderr); return result.stdout.trim();
  } catch (error) { await writeFile(log, (error.stdout ?? '') + (error.stderr ?? '') + String(error)); throw new Error(`Command failed; see ${log}`, { cause: error }); }
}
const npm = (args, cwd) => process.env.npm_execpath ? command(process.execPath, [process.env.npm_execpath, ...args], cwd)
  : command(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
const hash = (body) => createHash('sha256').update(body).digest('hex');
const report = { status: 'running', runRoot, appRoot, source, startedAt: new Date().toISOString(), stages: {} };
console.log(`External installed graph/document consumer: ${appRoot}`);
try {
  const packs = [];
  for (const root of [repositoryRoot, sourceRoot]) {
    const packed = JSON.parse(await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', path.join(runRoot, 'archives')], root))[0];
    const archive = path.join(runRoot, 'archives', packed.filename); const bytes = await readFile(archive);
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, packed.integrity); packs.push({ packed, archive, sha256: hash(bytes) });
  }
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(sourceRoot, 'package-lock.json'), 'utf8'));
  const monsqlizeVersion = lock.packages['node_modules/monsqlize'].version;
  await writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'capability-graph-vextjs-consumer', private: true, type: 'module',
    dependencies: { '@devcodex/capability-graph': `file:${packs[0].archive}`, vextjs: `file:${packs[1].archive}`, monsqlize: monsqlizeVersion } }, null, 2) + '\n');
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], appRoot);
  const coreRoot = path.join(appRoot, 'node_modules/@devcodex/capability-graph');
  const installed = JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8')); assert.equal(installed.version, manifest.version);
  const { CapabilityGraph } = await import(pathToFileURL(path.join(coreRoot, 'dist/index.js')).href);
  const frameworkRoot = path.join(appRoot, 'node_modules/vextjs');
  await mkdir(path.join(appRoot, 'src/config'), { recursive: true });
  await writeFile(path.join(appRoot, 'src/config/default.js'), 'export default { logger: { level: "silent" }, frontend: { enabled: false }, openapi: { enabled: false } };\n');
  report.stages.installation = { coreVersion: installed.version, archives: packs.map(({ packed, sha256 }) => ({ name: packed.name, integrity: packed.integrity, sha256 })),
    monsqlizeVersion, consumerLockSha256: hash(await readFile(path.join(appRoot, 'package-lock.json'))), nodeModulesSymlink: false };
  report.stages.documentation = await validateVextDocumentation({ frameworkRoot, sourceRoot, sourceIdentity, graphClass: CapabilityGraph });
  report.stages.sources = await validateProviderSources({ sourceRoot, installedProject: appRoot, sourceIdentity, includeHttps: flags.includes('--https'), graphClass: CapabilityGraph });
  report.stages.nativeDeclarations = await validateVextjs({ frameworkRoot, projectRoot: appRoot, sourceRoot, sourceIdentity, graphClass: CapabilityGraph });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); throw error; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(path.join(runRoot, 'reports/verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Verification ${report.status}; retained report: ${path.join(runRoot, 'reports/verification.json')}`); }
