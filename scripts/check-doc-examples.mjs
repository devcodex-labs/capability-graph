import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const source = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.CG_DOC_CONSUMER) {
  // Reuse the existing cold-install boundary instead of building a second pack harness.
  const child = spawnSync(process.execPath, [path.join(source, 'scripts/package-smoke.mjs')], {
    cwd: source, env: process.env, stdio: 'inherit'
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const consumer = path.resolve(process.env.CG_DOC_CONSUMER);
const artifacts = path.resolve(process.env.CG_DOC_ARTIFACTS_DIR);
assert(artifacts !== source && !artifacts.startsWith(source + path.sep));
await fs.mkdir(artifacts, {recursive: true});
const fixture = await fs.mkdtemp(path.join(consumer, 'docs-consumer-'));
const packageRoot = path.join(consumer, 'node_modules/@devcodex/capability-graph');
assert(!(await fs.lstat(packageRoot)).isSymbolicLink(), 'Expected an independently installed package');
await fs.cp(path.join(packageRoot, 'examples'), path.join(fixture, 'examples'), {recursive: true});
const normalize = text => text.replace(/\r\n/g, '\n').trim();
const hash = text => createHash('sha256').update(text).digest('hex');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'website/scripts/example-cases.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
const results = [];
const fence = String.fromCharCode(96).repeat(3);
const blocks = text => [...text.matchAll(new RegExp('^' + fence + '(\\w+)([^\\n]*)\\r?\\n([\\s\\S]*?)\\r?\\n' + fence, 'gm'))]
  .map(match => ({language: match[1], title: match[2].match(/title="([^"]+)"/)?.[1], code: match[3]}));
const readPage = relative => fs.readFile(path.join(source, 'website/content', relative), 'utf8');
async function run(id, file, cwd = fixture, expected = 0, extra = {}, flags = [], tail = []) {
  const child = spawnSync(process.execPath, [...flags, file, ...tail], {
    cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, env: {...process.env, ...extra}
  });
  if (child.error) throw child.error;
  await fs.writeFile(path.join(artifacts, id + '.stdout.txt'), child.stdout);
  await fs.writeFile(path.join(artifacts, id + '.stderr.txt'), child.stderr);
  assert.equal(child.status, expected, id + '\n' + child.stdout + '\n' + child.stderr);
  return {stdout: child.stdout, stderr: child.stderr, exitCode: child.status};
}
const minimalDir = path.join(fixture, 'minimal-file');
const inlineDir = path.join(fixture, 'minimal-inline');
await fs.mkdir(minimalDir); await fs.mkdir(inlineDir);
const quick = blocks(await readPage('getting-started/quick-start.md'));
const provider = quick.find(block => block.title === 'provider.json').code;
await fs.writeFile(path.join(minimalDir, 'provider.json'), provider);
let minimal;
for (const item of manifest.cases) {
  const page = await readPage(item.page);
  const codeBlocks = blocks(page);
  let code = item.title ? codeBlocks.find(block => block.title === item.title)?.code : undefined;
  if (item.title) assert(code, 'Missing titled example: ' + item.id);
  if (item.source) {
    const distributed = await fs.readFile(path.join(packageRoot, item.source), 'utf8');
    const current = await fs.readFile(path.join(source, item.source), 'utf8');
    assert.equal(normalize(distributed), normalize(current), 'Packed example differs: ' + item.source);
    code ??= codeBlocks.find(block => normalize(block.code) === normalize(distributed))?.code;
    if (!['vextjs-graph', 'vextjs-framework'].includes(item.id)) {
      assert(code, 'Missing literal example: ' + item.id);
      assert.equal(normalize(code), normalize(distributed), 'Published example drift: ' + item.id);
    }
  }
  let target;
  if (code) {
    target = item.source ? path.join(fixture, item.source) : path.join(fixture, item.title);
    if (item.id === 'minimal-file') target = path.join(minimalDir, 'static.mjs');
    if (item.id === 'minimal-inline') target = path.join(inlineDir, 'inline.mjs');
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, code + '\n');
  }
  const evidence = {id: item.id, category: item.category, page: item.page,
    ...(code ? {literalCodeSha256: hash(code)} : {}), prerequisites: item.prerequisites};
  if (['conditional', 'static'].includes(item.category)) {
    if (target) await run(item.id + '-syntax', target, fixture, 0, {}, ['--check']);
    results.push({...evidence, status: 'NOT_RUN', staticSyntax: target ? 'PASS' : 'N/A'});
    continue;
  }
  if (item.id === 'mcp-http') continue;
  if (item.category === 'controlled') {
    const preload = path.join(fixture, 'controlled-fetch.mjs');
    await fs.writeFile(preload, '(' + controlledFetch.toString() + ')();\n');
    for (const [mode, expectedCode] of [
      ['success', null], ['refusal', 'CG_MODEL_REFUSED'], ['truncated', 'CG_MODEL_OUTPUT_INVALID'],
      ['bad-json', 'CG_MODEL_OUTPUT_INVALID'], ['oversize', 'CG_MODEL_OUTPUT_TOO_LARGE'],
      ['http-error', 'CG_MODEL_UNAVAILABLE'], ['no-body', 'CG_MODEL_UNAVAILABLE'],
      ['invalid-selection', 'CG_MODEL_OUTPUT_INVALID']
    ]) {
      const result = await run('custom-' + mode, target, fixture, expectedCode ? 1 : 0, {
        CG_CUSTOM_MODEL_URL: 'https://controlled.invalid/chat/completions',
        CG_CUSTOM_API_KEY: 'fixture-never-sent', CG_CUSTOM_MODEL: 'fixture', CG_TEST_REPLY: mode
      }, ['--import', pathToFileURL(preload).href]);
      if (expectedCode) assert.equal(JSON.parse(result.stderr).code, expectedCode);
      else assert.equal(JSON.parse(result.stdout).status, 'matched');
    }
    results.push({...evidence, status: 'PASS', branches: 8, realEndpoint: 'NOT_RUN'});
    continue;
  }
  if (item.id === 'mcp-stdio') {
    await fs.writeFile(path.join(fixture, 'provider.json'), provider);
    await fs.writeFile(path.join(fixture, 'graph.config.json'), quick.find(block => block.title === 'graph.config.json').code);
  }
  const result = await run(item.id, target ?? path.join(fixture, item.source),
    item.id === 'minimal-file' ? minimalDir : item.id === 'minimal-inline' ? inlineDir : fixture,
    item.category === 'expected-error' ? 1 : 0);
  if (item.category === 'expected-error') assert.equal(JSON.parse(result.stderr).code, item.expectedCode);
  else {
    const value = JSON.parse(result.stdout);
    if (item.id === 'minimal-file') {
      minimal = value; assert.deepEqual(value.selected, ['acme::route']);
      assert.equal(value.nodes[1].capability.usage, undefined);
      assert.deepEqual(await fs.readdir(minimalDir), ['provider.json', 'static.mjs']);
    }
    if (item.id === 'minimal-inline') {
      assert.deepEqual(value, minimal); assert.deepEqual(await fs.readdir(inlineDir), ['inline.mjs']);
    }
    if (['minimal-file', 'minimal-inline', 'multi-provider', 'vextjs-graph'].includes(item.id)) {
      assert.equal(value.meta.completeness, 'complete'); assert.deepEqual(value.unresolved, []);
      assert(value.nodes.every(node => node.capability.id && node.origin && node.applicability));
    }
    if (item.id === 'details') {
      assert.equal(value.document.documentId, 'guide'); assert(value.details.items[0].capability.usage);
    }
    if (item.id === 'mcp-stdio') assert.deepEqual(value.structuredContent, minimal);
  }
  results.push({...evidence, status: 'PASS', exitCode: result.exitCode});
}
for (const file of ['README.md', 'website/content/getting-started/quick-start.md', 'website/content/index.mdx']) {
  const text = await fs.readFile(path.join(source, file), 'utf8');
  const examples = blocks(text).filter(block => block.language === 'json').flatMap(block => {
    try { return [JSON.parse(block.code)]; } catch { return []; }
  });
  assert(examples.some(value => JSON.stringify(value) === JSON.stringify(minimal)), 'Complete ResolveResult drift: ' + file);
}
const {CapabilityGraph} = await import(pathToFileURL(path.join(packageRoot, 'dist/index.js')));
const {createMcpServer} = await import(pathToFileURL(path.join(packageRoot, 'dist/mcp/index.js')));
const graph = await CapabilityGraph.open({providers: [{file: path.join(fixture, 'provider.json')}]});
const server = createMcpServer({graph, transport: 'http', http: {port: 0}});
let address, port;
try {
  address = await server.start(); port = new URL(address.url).port;
  await fs.writeFile(path.join(artifacts, 'service.json'), JSON.stringify({
    command: process.execPath + ' scripts/check-doc-examples.mjs', cwd: source, pid: process.pid, port, url: address.url
  }, null, 2));
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(fixture, 'mcp-http.mjs')], {
      cwd: fixture, env: {...process.env, CG_MCP_URL: address.url}, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {child.kill(); reject(new Error('HTTP page client timed out'));}, 30000);
    child.stdout.on('data', bytes => {stdout += bytes;});
    child.stderr.on('data', bytes => {stderr += bytes;});
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('close', exitCode => {clearTimeout(timer); resolve({stdout, stderr, exitCode});});
  });
  await fs.writeFile(path.join(artifacts, 'mcp-http.stdout.json'), output.stdout);
  await fs.writeFile(path.join(artifacts, 'mcp-http.stderr.txt'), output.stderr);
  assert.equal(output.exitCode, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout).structuredContent, minimal);
  results.push({id: 'mcp-http', category: 'required', status: 'PASS', exitCode: 0});
  const consumerRequire = createRequire(path.join(consumer, 'package.json'));
  const {Client} = await import(pathToFileURL(consumerRequire.resolve('@modelcontextprotocol/client')));
  const {StdioClientTransport} = await import(pathToFileURL(consumerRequire.resolve('@modelcontextprotocol/client/stdio')));
  const legacy = new Client({name: 'legacy-doc-consumer', version: '1'}, {versionNegotiation: {mode: 'legacy'}});
  const transport = new StdioClientTransport({command: process.execPath,
    args: [path.join(packageRoot, 'dist/cli/main.js'), 'serve', '--config', path.join(fixture, 'graph.config.json')], stderr: 'pipe'});
  transport.stderr?.on('data', () => {});
  try {
    await legacy.connect(transport);
    assert.equal(legacy.getNegotiatedProtocolVersion(), '2025-06-18');
    const result = await legacy.callTool({name: 'capability_graph_resolve', arguments: {ids: ['acme::route']}});
    assert.deepEqual(result.structuredContent, minimal);
    await fs.writeFile(path.join(artifacts, 'mcp-legacy.json'), JSON.stringify(result, null, 2));
  } finally {await legacy.close();}
  assert.equal(transport.pid, null);
  results.push({id: 'mcp-legacy-2025-06-18', category: 'required', status: 'PASS'});
} finally {
  await server.close(); await graph.close();
  const released = !port || await new Promise(resolve => {
    const socket = net.connect(Number(port), '127.0.0.1');
    socket.once('connect', () => {socket.destroy(); resolve(false);});
    socket.once('error', () => resolve(true));
  });
  await fs.writeFile(path.join(artifacts, 'cleanup.json'), JSON.stringify({pid: process.pid, port, released}));
  assert(released, 'HTTP example service was not released');
}
const pluginBlocks = blocks(await readPage('integrations/skill-plugin.md'));
const config = JSON.parse(pluginBlocks.find(block => block.title === 'plugin/graph.config.json').code);
const marketplace = JSON.parse(pluginBlocks.find(block => block.title === '.agents/plugins/marketplace.json').code);
assert.equal(marketplace.plugins[0].source.path, './plugin');
assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
assert.equal(marketplace.plugins[0].policy.authentication, 'ON_INSTALL');
const pluginRoot = path.join(fixture, 'marketplace');
await fs.cp(path.join(packageRoot, 'plugin'), path.join(pluginRoot, 'plugin'), {recursive: true});
await fs.mkdir(path.join(pluginRoot, 'providers/acme'), {recursive: true});
await fs.writeFile(path.join(pluginRoot, 'providers/acme/provider.json'), provider);
await fs.writeFile(path.join(pluginRoot, 'plugin/graph.config.json'), JSON.stringify(config));
for (const file of ['plugin.json', '.codex-plugin/plugin.json', 'mcp.json', '.mcp.json']) {
  const value = JSON.parse(await fs.readFile(path.join(pluginRoot, 'plugin', file), 'utf8'));
  if (file.endsWith('mcp.json')) assert.equal(value.mcpServers.capability_graph.url, 'http://127.0.0.1:3333/mcp');
  else assert.equal(value.name, 'capability-graph');
}
const cli = path.join(packageRoot, 'dist/cli/main.js');
await run('provider-patterns', cli, fixture, 0, {}, [],
  ['validate', '--file', 'examples/scenarios/provider-patterns.json']);
results.push({id:'provider-patterns', category:'required', status:'PASS', exitCode:0});
const doctor = await run('plugin-doctor', cli, pluginRoot, 0, {}, [], ['doctor', '--config', 'plugin/graph.config.json']);
assert.equal(JSON.parse(doctor.stdout).items[0].capabilityCount, 2);
Object.assign(results.find(item => item.id === 'plugin'), {staticConfig: 'PASS', realHostInstall: 'NOT_RUN'});
const remoteConfig = JSON.parse(blocks(await readPage('integrations/remote.md')).find(block => block.title === 'graph.config.json').code);
await fs.mkdir(path.join(fixture, 'providers/acme'), {recursive: true});
await fs.writeFile(path.join(fixture, 'providers/acme/provider.json'), provider);
await fs.writeFile(path.join(fixture, 'remote.config.json'), JSON.stringify(remoteConfig));
await run('remote-doctor', cli, fixture, 0, {CG_HTTP_TOKEN: 'fixture-not-used-over-network'}, [],
  ['doctor', '--config', 'remote.config.json']);
Object.assign(results.find(item => item.id === 'remote'), {staticConfig: 'PASS', realHTTPS: 'NOT_RUN'});
const names = [...(await fs.readFile(path.join(source, 'src/types.ts'), 'utf8')).matchAll(/^export (?:type|interface) (\w+)/gm)].map(match => match[1]);
await fs.writeFile(path.join(fixture, 'all-public-types.ts'),
  "import {CapabilityGraph,GraphError} from '@devcodex/capability-graph';\n" +
  "import type {" + names.join(',') + "} from '@devcodex/capability-graph';\n" +
  "import {createGraphTools,type GraphToolsOptions,type GraphToolDefinition,type ToolCallOutcome,type GraphTools} from '@devcodex/capability-graph/tools';\n" +
  "import {createMcpServer,type McpLimits,type McpHttpOptions,type McpServerOptions,type McpServerAddress,type McpServer} from '@devcodex/capability-graph/mcp';\n" +
  "import {createOpenAIExecutor,type OpenAIExecutorOptions} from '@devcodex/capability-graph/adapters/openai';\n" +
  "import {createCodexExecutor,type CodexExecutorOptions} from '@devcodex/capability-graph/adapters/codex';\n" +
  "type RootContracts=[" + names.join(',') + "];\n" +
  "type SubContracts=[GraphToolsOptions,GraphToolDefinition,ToolCallOutcome,GraphTools,McpLimits,McpHttpOptions,McpServerOptions,McpServerAddress,McpServer,OpenAIExecutorOptions,CodexExecutorOptions];\n" +
  "declare const root:RootContracts;declare const sub:SubContracts;void[root,sub,CapabilityGraph,GraphError,createGraphTools,createMcpServer,createOpenAIExecutor,createCodexExecutor];\n");
await run('all-public-types', path.join(consumer, 'node_modules/typescript/bin/tsc'), fixture, 0, {}, [],
  ['--pretty', 'false', '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'all-public-types.ts']);
const report = {status: 'PASS', node: process.version, platform: process.platform, fixture,
  packageIntegrity: process.env.CG_DOC_PACKAGE_INTEGRITY, results,
  types: {rootTypes: names.length, childTypes: 11, entryPoints: 5, skipLibCheck: false},
  realModelRequests: 0, realHostChanges: 0,
  registryFreshInstall: 'NOT_RUN: run after user publishes the documented version'};
await fs.writeFile(path.join(artifacts, 'examples.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({status: report.status, cases: results.length, artifacts, conditional: results.filter(item => item.status === 'NOT_RUN').map(item => item.id)}));

function controlledFetch() {
  globalThis.fetch = async (url, init) => {
    if (new URL(url.toString()).protocol !== 'https:' || !(init.signal instanceof AbortSignal)) throw new Error('Invalid controlled request');
    const request = JSON.parse(init.body);
    if (!request.messages) throw new Error('Expected Chat Completions body');
    const catalog = JSON.parse(request.messages[1].content).catalog;
    if (catalog.some(item => 'usage' in item || 'documents' in item)) throw new Error('Model catalog contains detail fields');
    const mode = process.env.CG_TEST_REPLY;
    if (mode === 'no-body') return new Response(null, {status: 200});
    if (mode === 'oversize') return new Response('x'.repeat(1048577));
    if (mode === 'http-error') return new Response('{}', {status: 401});
    if (mode === 'bad-json') return new Response('{');
    const message = {content: JSON.stringify({decision: 'selected', ids: ['acme::route']})};
    if (mode === 'refusal') message.refusal = 'Controlled refusal';
    if (mode === 'invalid-selection') message.content = JSON.stringify({decision: 'none', ids: ['acme::route']});
    return new Response(JSON.stringify({choices: [{finish_reason: mode === 'truncated' ? 'length' : 'stop', message}]}),
      {headers: {'content-type': 'application/json'}});
  };
}
