import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stableVersion} from './check-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';
export function fingerprint(bytes) {
  return {sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64')};
}
export function npmJSON(result) {
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new Error('npm returned no usable JSON; registry availability is unknown.'); }
  if (result.status === 0 && !value?.error) return value;
  if (value?.error?.code === 'E404') return undefined;
  throw new Error('npm registry query failed; absence has not been established.');
}
export function publicationPlan(local, exact, latest) {
  if (latest !== undefined) {
    if (!stableVersion.test(latest)) throw new Error('The latest dist-tag is not a stable version.');
    const a = latest.split('.').map(BigInt), b = local.version.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) throw new Error('Refusing to move latest backwards.');
      if (a[i] < b[i]) break;
    }
  }
  if (exact !== undefined && exact.integrity !== local.integrity) throw new Error('This version already exists with different package bytes.');
  return {publish: exact === undefined};
}
export async function loadArtifact(tarball) {
  const file = await fs.realpath(tarball);
  const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'release-package.json'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const hashes = fingerprint(await fs.readFile(file));
  if (manifest.name !== pkg.name || manifest.version !== pkg.version || manifest.filename !== path.basename(file) || manifest.sha256 !== hashes.sha256 || manifest.integrity !== hashes.integrity) throw new Error('Release artifact identity or bytes differ from the verified package.');
  const packed = spawnSync('tar', ['-xOf', file, 'package/package.json'], {encoding: 'utf8', maxBuffer: 1048576, timeout: 10000});
  let identity;
  try { identity = JSON.parse(packed.stdout); } catch { throw new Error('Cannot read the release archive package identity.'); }
  if (packed.error || packed.status !== 0 || identity.name !== pkg.name || identity.version !== pkg.version) throw new Error('Packed package identity differs from the release.');
  if ((await fs.readFile(path.join(path.dirname(file), 'SHA256SUMS'), 'utf8')) !== `${hashes.sha256}  ${manifest.filename}\n`) throw new Error('Release checksums differ.');
  return {...manifest, file};
}
function npm(args, cwd, env = {}) {
  const result = spawnSync('npm', [...args, '--registry=' + registry], {cwd, encoding: 'utf8', timeout: 120000, env: {...process.env, ...env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH}, shell: process.platform === 'win32'});
  if (result.error) throw new Error('npm could not complete the registry operation.');
  return result;
}
function query(spec, field) { return npmJSON(npm(['view', spec, field, '--json'], root)); }
async function plan(local) {
  return publicationPlan(local, query(local.name + '@' + local.version, 'dist'), query(local.name + '@latest', 'version'));
}
async function verify(local, output) {
  let dist;
  for (let i = 0; i < 5; i++) {
    dist = query(local.name + '@' + local.version, 'dist');
    if (dist !== undefined) break;
    if (i < 4) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (dist?.integrity !== local.integrity) throw new Error('Published registry integrity differs or is unavailable.');
  if (new URL(dist.tarball).origin !== 'https://registry.npmjs.org') throw new Error('Registry tarball must use the official HTTPS origin.');
  const env = {npm_config_cache: path.join(output, 'fresh-npm-cache')};
  const downloaded = npmJSON(npm(['pack', local.name + '@' + local.version, '--ignore-scripts', '--json', '--pack-destination', output], output, env));
  if (!Array.isArray(downloaded) || downloaded.length !== 1 || path.basename(downloaded[0].filename) !== downloaded[0].filename) throw new Error('Registry archive identity is invalid.');
  if (fingerprint(await fs.readFile(path.join(output, downloaded[0].filename))).integrity !== local.integrity) throw new Error('Downloaded registry bytes differ from the verified archive.');
  for (const [label, spec] of [['exact', local.name + '@' + local.version], ['default', local.name]]) {
    const consumer = path.join(output, label); await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({name: 'registry-consumer', version: '0.0.0', private: true, type: 'module'}));
    if (npm(['install', spec, '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], consumer, env).status !== 0) throw new Error('Registry installation failed: ' + label);
    const installed = path.join(consumer, 'node_modules', '@devcodex/capability-graph');
    if ((await fs.lstat(installed)).isSymbolicLink() || JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8')).version !== local.version) throw new Error('Registry installation resolved another version: ' + label);
    await fs.writeFile(path.join(consumer, 'check.mjs'), `import assert from 'node:assert/strict';
import {CapabilityGraph} from '@devcodex/capability-graph';
import {createGraphTools} from '@devcodex/capability-graph/tools';
import {createMcpServer} from '@devcodex/capability-graph/mcp';
import {createOpenAIExecutor} from '@devcodex/capability-graph/adapters/openai';
import {createCodexExecutor} from '@devcodex/capability-graph/adapters/codex';
assert([createGraphTools,createMcpServer,createOpenAIExecutor,createCodexExecutor].every(v=>typeof v==='function'));
const graph=await CapabilityGraph.open({providers:[{definition:{providerId:'check',name:'Check',version:'1',capabilities:[]}}]});
try{assert.equal((await graph.listCatalog()).items.length,0);}finally{await graph.close();}
`);
    const check = spawnSync(process.execPath, ['check.mjs'], {cwd: consumer, encoding: 'utf8', timeout: 30000});
    if (check.error || check.status !== 0) throw new Error('Installed public entry verification failed: ' + label);
    const cli = spawnSync(process.execPath, [path.join(installed, 'dist/cli/main.js'), 'doctor', '--config', path.join(installed, 'examples/minimal/graph.config.json')], {cwd: consumer, encoding: 'utf8', timeout: 30000});
    if (cli.error || cli.status !== 0 || JSON.parse(cli.stdout).toolCount !== 5) throw new Error('Installed CLI verification failed: ' + label);
  }
  return {registryBytes: 'PASS', exactInstall: 'PASS', defaultInstall: 'PASS', entriesAndBin: 'PASS'};
}
async function main() {
  const [verb, tarball, ...rest] = process.argv.slice(2);
  if (!['plan', 'verify'].includes(verb) || !tarball || rest.length) throw new Error('Usage: release-registry.mjs plan|verify <verified.tgz>');
  const local = await loadArtifact(tarball);
  if (verb === 'plan') {
    const result = await plan(local);
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `publish=${result.publish}\n`);
    console.log(JSON.stringify({name: local.name, version: local.version, ...result})); return;
  }
  const output = path.resolve(process.env.CG_RELEASE_VERIFY_DIR ?? path.join(path.dirname(local.file), 'registry-verification'));
  if (output === root || output.startsWith(root + path.sep) || root.startsWith(output + path.sep)) throw new Error('Registry verification output must be outside source.');
  await fs.mkdir(output, {recursive: true});
  const work = await fs.mkdtemp(path.join(output, 'consumer-'));
  let report;
  try { report = {status: 'PASS', name: local.name, version: local.version, ...await verify(local, work)}; }
  catch (error) { report = {status: 'FAIL', name: local.name, version: local.version, error: error.message}; throw error; }
  finally { await fs.writeFile(path.join(output, 'registry-verification.json'), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
