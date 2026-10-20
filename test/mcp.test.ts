import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CapabilityGraph, GraphError } from '../src/index.js';
import { createGraphTools } from '../src/tools/index.js';
import { createMcpServer } from '../src/mcp/index.js';
import type { McpHttpOptions } from '../src/mcp/index.js';
import type { ProviderDefinition } from '../src/index.js';

const p = (): ProviderDefinition => ({ providerId: 'acme', name: 'Acme', version: '1', capabilities: [{ id: 'route', name: 'Route', description: 'HTTP', relations: { requires: ['schema'] }, documents: [{ id: '中文说明', source: { type: 'file', path: 'guide.md' } }] }, { id: 'schema', name: 'Schema', description: 'Request validation' }] });
async function fixture(run: (root: string, graph: CapabilityGraph) => Promise<void>, definition = p()): Promise<void> {
  const base = path.resolve(process.env.CG_TEST_DIR!); await mkdir(base, { recursive: true }); const root = await mkdtemp(path.join(base, 'mcp-'));
  await writeFile(path.join(root, 'guide.md'), 'Public synthetic guide');
  const graph = await CapabilityGraph.open({ providers: [{ definition, documentRoot: root }], allowedProviders: ['acme'] });
  try { await run(root, graph); } finally { await graph.close(); await rm(root, { recursive: true, force: true }); }
}
async function connected(graph: CapabilityGraph, http: McpHttpOptions = {}) {
  const server = createMcpServer({ graph, transport: 'http', http: { port: 0, ...http } });
  const address = await server.start(); assert.equal(address.transport, 'http'); if (address.transport !== 'http') throw new Error();
  const client = new Client({ name: 'new-product-test', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(address.url)));
  return { server, client, address };
}
test('Tool Adapter is borrowed, defaults to five tools and matches SDK success/error semantics', async () => fixture(async (_root, graph) => {
  const tools = createGraphTools(graph); assert.equal(tools.definitions.length, 5); assert(!tools.definitions.some(t => t.name.endsWith('_match')));
  assert.deepEqual(await tools.call('capability_graph_resolve', { ids: ['acme::route'] }), { ok: true, data: await graph.resolve({ ids: ['acme::route'] }) });
  const invalid = await tools.call('capability_graph_get_capabilities', { ids: ['acme::route'], context: { facts: { x: null } } }); assert(!invalid.ok); assert.equal(invalid.error.code, 'CG_CONTEXT_INVALID');
  const denied = await tools.call('capability_graph_get_capabilities', { ids: ['private::route'] }); assert(!denied.ok); assert.equal(denied.error.code, 'CG_ACCESS_DENIED');
  assert.throws(() => createGraphTools(graph, { enableMatch: true }), e => e instanceof GraphError && e.code === 'CG_MODEL_NOT_CONFIGURED');
}));
test('MCP defaults apply only to omitted settings; malformed HTTP/auth/limit objects fail before starting', async () => fixture(async (_root, graph) => {
  for (const http of [null, 0, [], { host: null }, { port: null }, { path: null }, { access: null }, { auth: null }, { limits: null }, { limits: [] }]) {
    assert.throws(() => createMcpServer({ graph, transport: 'http', http: http as unknown as McpHttpOptions }), e => e instanceof GraphError && e.code === 'CG_CONFIG_INVALID');
  }
  const valid = createMcpServer({ graph, transport: 'http', http: {} }); await valid.close();
}));

test('HTTP request and shutdown timers reject values beyond the Node timer range before listening', async () => fixture(async (_root, graph) => {
  for (const field of ['requestTimeoutMs', 'shutdownTimeoutMs'] as const) {
    const maximum = createMcpServer({ graph, transport: 'http', http: { port: 0, limits: { [field]: 2147483647 } } }); await maximum.close();
    for (const value of [2147483648, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => createMcpServer({ graph, transport: 'http', http: { port: 0, limits: { [field]: value } } }), e => e instanceof GraphError && e.code === 'CG_CONFIG_INVALID' && e.phase === 'config' && e.nextAction === 'check_config');
    }
  }
}));

test('model recovery actions agree across SDK, Tool Adapter and actual MCP projection', async () => {
  for (const [code, nextAction] of [['CG_MODEL_CONTEXT_EXCEEDED', 'narrow_scope'], ['CG_MODEL_OUTPUT_TOO_LARGE', 'narrow_scope'], ['CG_MODEL_REFUSED', 'fix_input'], ['CG_MODEL_INVALID_SELECTION', 'refresh'], ['CG_MODEL_UNAVAILABLE', 'check_config']] as const) {
    const graph = await CapabilityGraph.open({ providers: [{ definition: p() }], model: { id: 'recovery', async select() { throw new GraphError(code, 'match', 'private upstream detail', nextAction); } } });
    const server = createMcpServer({ graph, transport: 'http', enableMatch: true, http: { port: 0, limits: { requestTimeoutMs: 65000 } } });
    const client = new Client({ name: 'recovery-consumer', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    try {
      let sdkError: unknown;
      await assert.rejects(graph.match({ input: 'x' }), e => { assert(e instanceof GraphError); assert.equal(e.nextAction, nextAction); assert(!e.message.includes('private')); sdkError = e.toJSON(); return true; });
      const tool = await createGraphTools(graph, { enableMatch: true }).call('capability_graph_match', { input: 'x' }); assert(!tool.ok); assert.deepEqual(tool.error, sdkError);
      const address = await server.start(); assert(address.transport === 'http');
      await client.connect(new StreamableHTTPClientTransport(new URL(address.url)));
      const mcp = await client.callTool({ name: 'capability_graph_match', arguments: { input: 'x' } }); assert(mcp.isError);
      const text = mcp.content.find(item => item.type === 'text'); assert(text?.type === 'text'); assert.deepEqual(JSON.parse(text.text), sdkError);
    } finally { await client.close(); await server.close(); await graph.close(); }
  }
});
test('official modern HTTP publishes standalone schemas and all five real tool calls match the SDK', async () => fixture(async (_root, graph) => {
  const { server, client } = await connected(graph);
  try {
    assert.equal(client.getProtocolEra(), 'modern'); const { tools } = await client.listTools(); assert.equal(tools.length, 5);
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true });
    const calls = [
      ['list_providers', {}, await graph.listProviders()], ['list_catalog', {}, await graph.listCatalog()],
      ['get_capabilities', { ids: ['acme::route'] }, await graph.getCapabilities({ ids: ['acme::route'] })],
      ['resolve', { ids: ['acme::route'] }, await graph.resolve({ ids: ['acme::route'] })],
      ['read_document', { capabilityId: 'acme::route', documentId: '中文说明' }, await graph.readDocument({ capabilityId: 'acme::route', documentId: '中文说明' })],
    ] as const;
    for (const [name, args, expected] of calls) {
      const definition = tools.find(t => t.name === 'capability_graph_' + name)!; assert(definition.inputSchema); assert(definition.outputSchema);
      const input = ajv.compile(definition.inputSchema as AnySchema); const output = ajv.compile(definition.outputSchema! as AnySchema); assert(input(args));
      const result = await client.callTool({ name: definition.name, arguments: args }); assert.equal(result.isError, false); assert(output(result.structuredContent), JSON.stringify(output.errors)); assert.deepEqual(result.structuredContent, expected);
    }
    const bad = await client.callTool({ name: 'capability_graph_get_capabilities', arguments: { ids: [] } }); assert.equal(bad.isError, true); assert.equal(bad.structuredContent, undefined); assert.equal(JSON.parse((bad.content as Array<{ text: string }>)[0]!.text).code, 'CG_INPUT_INVALID');
    const invalidRelations = { ids: ['acme::route'], relations: null };
    const resolveSchema = ajv.compile(tools.find(t => t.name === 'capability_graph_resolve')!.inputSchema as AnySchema);
    assert.equal(resolveSchema(invalidRelations), false);
    const invalid = await client.callTool({ name: 'capability_graph_resolve', arguments: invalidRelations });
    assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent, undefined); assert.equal(JSON.parse((invalid.content as Array<{ text: string }>)[0]!.text).code, 'CG_INPUT_INVALID');
  } finally { await client.close(); await server.close(); await server.close(); await server.waitUntilClosed(); }
  assert.equal((await graph.listCatalog()).items.length, 2);
}));
test('the stdio legacy opt-in does not enable legacy HTTP negotiation', async () => fixture(async (_root, graph) => {
  const { server, client, address } = await connected(graph);
  try {
    const response = await fetch(address.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy-negative', version: '1' } } }) });
    const body = await response.text(); assert(response.status >= 400); assert(body.includes('2026-07-28')); assert(body.includes('2025-06-18'));
  } finally { await client.close(); await server.close(); }
}));
test('HTTP rejects authority/origin/auth/routing/method and both declared/chunked oversized bodies before calls', async () => fixture(async (_root, graph) => {
  const server = createMcpServer({ graph, transport: 'http', http: { port: 0, auth: { type: 'bearer', token: 'synthetic-token' }, limits: { maxBodyBytes: 512 } } });
  const address = await server.start(); if (address.transport !== 'http') throw new Error();
  try {
    assert.equal((await fetch(address.url)).status, 401);
    const auth = { authorization: 'Bearer synthetic-token' };
    const rawStatus = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const request = httpRequest(address.url, { headers }, result => { result.resume(); resolve(result.statusCode!); }); request.once('error', reject); request.end();
    });
    assert.equal(await rawStatus({ ...auth, host: 'evil.example' }), 403);
    assert.equal(await rawStatus({ ...auth, origin: 'https://evil.example' }), 403);
    assert.equal((await fetch(address.url + '/bad', { headers: auth })).status, 404);
    assert.equal((await fetch(address.url, { method: 'PUT', headers: auth })).status, 405);
    assert.equal((await fetch(address.url, { method: 'POST', headers: auth, body: 'x'.repeat(513) })).status, 413);
    const chunked = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(address.url, { method: 'POST', headers: auth }, result => { result.resume(); resolve(result.statusCode!); });
      request.once('error', reject); request.write('x'.repeat(300)); request.end('x'.repeat(300));
    });
    assert.equal(chunked, 413);
  } finally { await server.close(); }
}));
test('public service requires explicit scope, hides body by default and rejects anonymous match', async () => fixture(async (_root, graph) => {
  const unapproved = await CapabilityGraph.open({ providers: [{ definition: p() }] });
  assert.throws(() => createMcpServer({ graph: unapproved, transport: 'http', http: { access: 'public-readonly' } }), e => e instanceof GraphError && e.code === 'CG_CONFIG_INVALID'); await unapproved.close();
  const { server, client } = await connected(graph, { access: 'public-readonly' });
  try { const result = await client.callTool({ name: 'capability_graph_read_document', arguments: { capabilityId: 'acme::route', documentId: '中文说明' } }); assert.equal(result.isError, true); assert.equal(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code, 'CG_ACCESS_DENIED'); }
  finally { await client.close(); await server.close(); }
  const modelGraph = await CapabilityGraph.open({ providers: [{ definition: p() }], allowedProviders: ['acme'], model: { id: 'no-cost', async select() { throw new Error('Must not run'); } } });
  assert.throws(() => createMcpServer({ graph: modelGraph, transport: 'http', enableMatch: true, http: { access: 'public-readonly', limits: { requestTimeoutMs: 75000 } } }), e => e instanceof GraphError && e.code === 'CG_CONFIG_INVALID'); await modelGraph.close();
}));
test('HTTP in-flight/deadline controls are real and close leaves borrowed Graph usable', async () => fixture(async (_root, graph) => {
  const read = graph.readDocument.bind(graph); let start!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  graph.readDocument = async q => { start(); await gate; return read(q); };
  const { server, client, address } = await connected(graph, { limits: { maxInFlight: 1, requestTimeoutMs: 500 } });
  try {
    const call = client.callTool({ name: 'capability_graph_read_document', arguments: { capabilityId: 'acme::route', documentId: '中文说明' } }); await started;
    assert.equal((await fetch(address.url)).status, 429); release(); assert.equal((await call).isError, false);
  } finally { release(); await client.close(); await server.close(); }
  graph.readDocument = async q => { await delay(80); return read(q); };
  const slow = await connected(graph, { limits: { requestTimeoutMs: 20 } });
  try { await assert.rejects(slow.client.callTool({ name: 'capability_graph_read_document', arguments: { capabilityId: 'acme::route', documentId: '中文说明' } })); await delay(100); }
  finally { await slow.client.close(); await slow.server.close(); }
  assert.equal((await graph.listCatalog()).items.length, 2);
}));
test('actual serialized MCP result budget returns an explicit tool error instead of truncation', async () => {
  const definition = p(); definition.capabilities = Array.from({ length: 800 }, (_, i) => ({ id: 'cap' + i, name: 'Capability ' + i, description: 'x'.repeat(300) }));
  await fixture(async (_root, graph) => {
    const { server, client } = await connected(graph, { limits: { maxResponseBytes: 131072 } });
    try { const result = await client.callTool({ name: 'capability_graph_list_catalog', arguments: {} }); assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined); assert.equal(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code, 'CG_RESULT_TOO_LARGE'); assert.equal((await graph.listCatalog()).items.length, 800); }
    finally { await client.close(); await server.close(); }
  }, definition);
});
test('official modern HTTP cancellation reaches the borrowed Graph model and server shutdown aborts an active turn', async () => {
  let started!: () => void, aborted!: () => void;
  let begin = new Promise<void>(resolve => { started = resolve; });
  let end = new Promise<void>(resolve => { aborted = resolve; });
  const graph = await CapabilityGraph.open({ providers: [{ definition: p() }], model: { id: 'cancellation-probe', async select(request) {
    started(); return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => { aborted(); reject(request.signal.reason); }, { once: true }));
  } } });
  const server = createMcpServer({ graph, transport: 'http', enableMatch: true, http: { port: 0, limits: { requestTimeoutMs: 75000, shutdownTimeoutMs: 500 } } });
  const address = await server.start(); if (address.transport !== 'http') throw new Error();
  const client = new Client({ name: 'cancellation-probe', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(address.url)));
  try {
    const controller = new AbortController(); const pending = client.callTool({ name: 'capability_graph_match', arguments: { input: 'Read' } }, { signal: controller.signal });
    const rejected = assert.rejects(pending); await begin; controller.abort(); await rejected; await Promise.race([end, delay(2000).then(() => { throw new Error('MCP cancellation did not reach executor'); })]);
    begin = new Promise<void>(resolve => { started = resolve; }); end = new Promise<void>(resolve => { aborted = resolve; });
    const second = client.callTool({ name: 'capability_graph_match', arguments: { input: 'Read' } }); const stopped = assert.rejects(second); await begin; await server.close(); await stopped; await end;
    assert.equal((await graph.listCatalog()).items.length, 2);
  } finally { await client.close(); await server.close(); await graph.close(); }
});
