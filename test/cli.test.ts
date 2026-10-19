import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
async function configured(run: (root: string, config: string) => Promise<void>) {
  const base = process.env.CG_TEST_DIR!; await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'cli-'));
  await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'demo', name: 'Demo', version: '1', capabilities: [{ id: 'read', name: 'Read', description: 'Read data', documents: [{ id: 'guide', source: { type: 'file', path: 'guide.md' } }] }] }));
  await writeFile(path.join(root, 'guide.md'), 'CLI guide'); const config = path.join(root, 'config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, providers: [{ file: './provider.json' }], allowedProviders: ['demo'], http: { port: 0 } }));
  try { await run(root, config); } finally { await rm(root, { recursive: true, force: true }); }
}
test('CLI validates files, resolves config-relative paths from another cwd and reports doctor without model calls', async () => configured(async (root, config) => {
  const call = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: path.dirname(root), timeout: 5000 });
  const valid = call('validate', '--file', path.join(root, 'provider.json')); assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout).items[0].providerId, 'demo');
  const doctor = call('doctor', '--config', config); assert.equal(doctor.status, 0, doctor.stderr); const result = JSON.parse(doctor.stdout); assert.equal(result.toolCount, 5); assert.equal(result.modelConfigured, false); assert.equal(result.modelVerification, 'not_run');
  const duplicate = call('doctor', '--config', config, '--config', config); assert.equal(duplicate.status, 1); assert.equal(JSON.parse(duplicate.stderr).error.code, 'CG_INPUT_INVALID');
  const secret = path.join(root, 'secret-config.json'); await writeFile(secret, JSON.stringify({ providers: [], model: { type: 'openai', apiKeyEnv: 'CG_TEST_MISSING_API_KEY', model: 'gpt-5' } }));
  const missing = call('doctor', '--config', secret); assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stderr).error.code, 'CG_CONFIG_INVALID');
}));
test('actual CLI stdio modern MCP discovers schemas, resolves and reads config-relative docs, then reaps process', async () => configured(async (_root, config) => {
  const client = new Client({ name: 'cli-stdio-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--config', config, '--transport', 'stdio'], stderr: 'pipe' });
  let diagnostics = ''; transport.stderr?.on('data', chunk => { diagnostics += String(chunk); });
  try {
    await client.connect(transport); assert.equal((await client.listTools()).tools.length, 5); assert.equal(client.getProtocolEra(), 'modern');
    const result = await client.callTool({ name: 'capability_graph_resolve', arguments: { ids: ['demo::read'] } }); assert.equal(result.isError, false); assert.deepEqual((result.structuredContent as Record<string, unknown>).selected, ['demo::read']);
    const document = await client.callTool({ name: 'capability_graph_read_document', arguments: { capabilityId: 'demo::read', documentId: 'guide' } }); assert.equal((document.structuredContent as Record<string, unknown>).text, 'CLI guide');
  } finally { await client.close(); }
  assert(diagnostics.includes('"ready":true')); assert.equal(transport.pid, null);
}));
test('CLI HTTP announces readiness on stderr, closes on SIGTERM and stdio closes on EOF', async () => configured(async (_root, config) => {
  const processExited = async (transport: 'http' | 'stdio', eof: boolean) => {
    const child = spawn(process.execPath, [cli, 'serve', '--config', config, '--transport', transport], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += String(chunk); });
    let ready!: () => void; const announced = new Promise<void>(resolve => { ready = resolve; });
    child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.includes('"ready":true')) ready(); });
    const exited = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await announced; if (eof) child.stdin.end(); else child.kill('SIGTERM'); const [code] = await exited; assert.equal(code, 0, stderr); assert.equal(stdout, ''); }
    finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  };
  // Windows terminate semantics do not deliver a catchable SIGTERM to Node.
  if (process.platform !== 'win32') await processExited('http', false);
  await processExited('stdio', true);
}));
test('legacy stdio 2025-06-18 negotiates, exposes valid schemas and preserves SDK results/errors', async () => configured(async (root, config) => {
  const client = new Client({ name: 'codex-era-consumer', version: '1' }, { versionNegotiation: { mode: 'legacy' }, supportedProtocolVersions: ['2025-06-18'] });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--config', config, '--transport', 'stdio'], stderr: 'pipe' }); transport.stderr?.on('data', () => {});
  try {
    await client.connect(transport); assert.equal(client.getProtocolEra(), 'legacy');
    const { tools } = await client.listTools(); assert.equal(tools.length, 5); const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
    for (const tool of tools) { assert(ajv.compile(tool.inputSchema as AnySchema)); assert(ajv.compile(tool.outputSchema! as AnySchema)); }
    for (const [name, args] of [['list_providers', {}], ['list_catalog', {}], ['get_capabilities', { ids: ['demo::read'] }], ['resolve', { ids: ['demo::read'] }], ['read_document', { capabilityId: 'demo::read', documentId: 'guide' }]] as const) {
      const result = await client.callTool({ name: 'capability_graph_' + name, arguments: args }); assert.equal(result.isError, false); assert(ajv.compile(tools.find(t => t.name.endsWith('_' + name))!.outputSchema! as AnySchema)(result.structuredContent)); assert.equal((result as any).resultType, undefined);
    }
    const bad = await client.callTool({ name: 'capability_graph_resolve', arguments: { ids: [] } }); assert.equal(bad.isError, true); assert.equal(bad.structuredContent, undefined); assert.equal(JSON.parse((bad.content as any)[0].text).code, 'CG_INPUT_INVALID');
  } finally { await client.close(); } assert.equal(transport.pid, null);
}));
test('legacy stdio cancellation reaches the executor and reaps the service process', async () => configured(async (root, _config) => {
  const entry = path.join(root, 'cancel.mjs'), graphModule = new URL('../src/index.js', import.meta.url).href, mcpModule = new URL('../src/mcp/index.js', import.meta.url).href;
  await writeFile(entry, `import {writeFile} from 'node:fs/promises';import {CapabilityGraph} from ${JSON.stringify(graphModule)};import {createMcpServer} from ${JSON.stringify(mcpModule)};const graph=await CapabilityGraph.open({providers:[{definition:{providerId:'demo',name:'Demo',version:'1',capabilities:[{id:'read',name:'Read',description:'Read'}]}}],model:{id:'controlled',async select(r){await writeFile(${JSON.stringify(path.join(root, 'began'))},'1');return new Promise((_,reject)=>{r.signal.addEventListener('abort',()=>{void writeFile(${JSON.stringify(path.join(root, 'aborted'))},'1').then(()=>reject(r.signal.reason));},{once:true});});}}});const s=createMcpServer({graph,transport:'stdio',enableMatch:true});await s.start();await s.waitUntilClosed();await graph.close();`);
  const client = new Client({ name: 'legacy-cancel', version: '1' }, { supportedProtocolVersions: ['2025-06-18'] });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe' }); transport.stderr?.on('data', () => {});
  const until = async (name: string) => { for (let i = 0; i < 100; i++) { if (await stat(path.join(root, name)).then(() => true, () => false)) return; await delay(20); } throw new Error('Missing ' + name); };
  try { await client.connect(transport); const controller = new AbortController(); const pending = client.callTool({ name: 'capability_graph_match', arguments: { input: 'read' } }, { signal: controller.signal }); const rejected = assert.rejects(pending); await until('began'); controller.abort(); await rejected; await until('aborted'); }
  finally { await client.close(); } assert.equal(transport.pid, null);
}));
