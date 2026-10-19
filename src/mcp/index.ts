import { Server, createMcpHandler } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from 'node:http';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { GraphError, fail } from '../errors.js';
import { createGraphTools } from '../tools/index.js';
import { hasExplicitScope } from '../runtime.js';
import { copyJSON } from '../json.js';
import type { CapabilityGraph } from '../graph.js';

export interface McpLimits { maxBodyBytes?: number; maxResponseBytes?: number; maxInFlight?: number; requestTimeoutMs?: number; shutdownTimeoutMs?: number }
export interface McpHttpOptions {
  host?: string; port?: number; path?: string; access?: 'local' | 'public-readonly' | 'private';
  auth?: { type: 'none' } | { type: 'bearer'; token: string }; publicDocuments?: boolean;
  allowedOrigins?: string[]; allowedHostnames?: string[]; limits?: McpLimits;
}
export interface McpServerOptions { graph: CapabilityGraph; transport: 'stdio' | 'http'; enableMatch?: boolean; http?: McpHttpOptions }
export type McpServerAddress = { transport: 'stdio' } | { transport: 'http'; host: string; port: number; path: string; url: string };
export interface McpServer { start(): Promise<McpServerAddress>; waitUntilClosed(): Promise<void>; close(): Promise<void> }
const defaults = { maxBodyBytes: 1024 ** 2, maxResponseBytes: 20 * 1024 ** 2, maxInFlight: 32, requestTimeoutMs: 30000, shutdownTimeoutMs: 5000 };
const loopback = (host: string) => host === 'localhost' || host === '::1' || /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/.test(host);
function response(res: ServerResponse, status: number, message: string): void { if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify({ error: message })); else res.destroy(); }
function validHost(value: string): string | undefined {
  try { const u = new URL('http://' + value); if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return; return u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return; }
}
export function createMcpServer(options: McpServerOptions): McpServer {
  if (!options || !['stdio', 'http'].includes(options.transport)) fail('CG_CONFIG_INVALID', 'config', 'Choose stdio or http MCP transport', 'check_config');
  const tools = createGraphTools(options.graph, { ...(options.enableMatch === undefined ? {} : { enableMatch: options.enableMatch }) });
  const http: McpHttpOptions = copyJSON(options.http === undefined ? {} : options.http, 'CG_CONFIG_INVALID', 'config');
  if (!http || typeof http !== 'object' || Array.isArray(http)) fail('CG_CONFIG_INVALID', 'config', 'MCP HTTP settings must be an object', 'check_config');
  if (Object.keys(http).some(key => !['host', 'port', 'path', 'access', 'auth', 'publicDocuments', 'allowedOrigins', 'allowedHostnames', 'limits'].includes(key))) fail('CG_CONFIG_INVALID', 'config', 'Unknown MCP HTTP setting', 'check_config');
  const host = http.host === undefined ? '127.0.0.1' : http.host; const port = http.port === undefined ? 3333 : http.port; const route = http.path === undefined ? '/mcp' : http.path; const access = http.access === undefined ? 'local' : http.access;
  if (http.limits !== undefined && (!http.limits || typeof http.limits !== 'object' || Array.isArray(http.limits))) fail('CG_CONFIG_INVALID', 'config', 'MCP HTTP limits must be an object', 'check_config');
  const limits = { ...defaults };
  for (const [key, value] of Object.entries(http.limits ?? {})) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value <= 0) fail('CG_CONFIG_INVALID', 'config', 'MCP limits must be known positive safe integers', 'check_config');
    limits[key as keyof typeof limits] = value;
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535 || typeof host !== 'string' || !host || typeof route !== 'string' || !route.startsWith('/') || /[?#]/.test(route) || !['local', 'public-readonly', 'private'].includes(access) || http.publicDocuments !== undefined && typeof http.publicDocuments !== 'boolean') fail('CG_CONFIG_INVALID', 'config', 'Invalid MCP HTTP endpoint or access mode', 'check_config');
  const auth = http.auth === undefined ? { type: 'none' as const } : http.auth;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) fail('CG_CONFIG_INVALID', 'config', 'MCP authentication must be an object', 'check_config');
  if (auth.type !== 'none' && auth.type !== 'bearer' || auth.type === 'bearer' && (typeof auth.token !== 'string' || !auth.token.trim()) || Object.keys(auth).some(key => !(auth.type === 'bearer' ? ['type', 'token'] : ['type']).includes(key))) fail('CG_CONFIG_INVALID', 'config', 'Invalid MCP authentication configuration', 'check_config');
  if (options.transport === 'http') {
    if (access === 'local' && !loopback(host)) fail('CG_CONFIG_INVALID', 'config', 'Local HTTP must bind a loopback address', 'check_config');
    if (access === 'private' && !loopback(host) && auth.type !== 'bearer') fail('CG_CONFIG_INVALID', 'config', 'Remote private HTTP requires bearer authentication', 'check_config');
    if (access === 'public-readonly' && (!hasExplicitScope(options.graph) || options.enableMatch)) fail('CG_CONFIG_INVALID', 'config', 'Public HTTP requires explicit approved Providers and forbids server match', 'check_config');
    if (options.enableMatch && (http.limits?.requestTimeoutMs === undefined || limits.requestTimeoutMs < 65000)) fail('CG_CONFIG_INVALID', 'config', 'HTTP match needs an explicit request deadline covering its 60-second Graph deadline', 'check_config');
  }
  for (const field of [http.allowedOrigins, http.allowedHostnames]) if (field !== undefined && (!Array.isArray(field) || field.some(value => typeof value !== 'string' || !value.trim()))) fail('CG_CONFIG_INVALID', 'config', 'Hostnames and origins must be explicit string arrays', 'check_config');
  const hostnames = new Set((http.allowedHostnames ?? (loopback(host) ? ['localhost', '127.0.0.1', '::1'] : [host])).map(h => {
    const normalized = validHost(h.includes(':') && !h.startsWith('[') ? '[' + h + ']' : h);
    if (!normalized) fail('CG_CONFIG_INVALID', 'config', 'Invalid allowed hostname', 'check_config');
    return normalized;
  }));
  const origins = new Set<string>();
  for (const value of http.allowedOrigins ?? []) {
    try { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.origin !== value) throw new Error(); origins.add(value); }
    catch { fail('CG_CONFIG_INVALID', 'config', 'Allowed origins must be exact HTTP(S) origins', 'check_config'); }
  }
  const token = auth.type === 'bearer' ? Buffer.from(auth.token, 'utf8') : undefined;
  const factory = () => {
    const server = new Server({ name: 'capability-graph', version: '2.0.0' }, { capabilities: { tools: {} }, supportedProtocolVersions: options.transport === 'stdio' ? ['2026-07-28', '2025-06-18'] : ['2026-07-28'] });
    server.setRequestHandler('tools/list', async () => ({ tools: tools.definitions.map(t => ({ ...t, inputSchema: t.inputSchema as { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: !t.name.endsWith('_match'), openWorldHint: t.name.endsWith('_match') } })) }));
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const name = request.params.name;
      const denied = access === 'public-readonly' && !http.publicDocuments && name === 'capability_graph_read_document';
      const outcome = denied ? { ok: false as const, error: { code: 'CG_ACCESS_DENIED', phase: 'document' as const, message: 'Document bodies are not approved for public access', nextAction: 'contact_admin' as const } } : await tools.call(name, request.params.arguments ?? {}, { signal: ctx.mcpReq.signal });
      let result = outcome.ok ? server.projectCallToolResult({ isError: false, content: [], structuredContent: outcome.data as Record<string, unknown> }, tools.definitions.find(t => t.name === name)?.outputSchema) : { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(outcome.error) }] };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') + 1024 > limits.maxResponseBytes) result = { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'CG_RESULT_TOO_LARGE', phase: 'query', message: 'Serialized MCP result exceeds maxResponseBytes', nextAction: 'narrow_scope' }) }] };
      return result;
    });
    return server;
  };
  let state: 'created' | 'starting' | 'running' | 'closing' | 'closed' = 'created';
  let startPromise: Promise<McpServerAddress> | undefined; let closePromise: Promise<void> | undefined;
  let address: McpServerAddress | undefined; let listener: HttpServer | undefined;
  let handler: ReturnType<typeof createMcpHandler> | undefined; let stdio: ReturnType<typeof serveStdio> | undefined;
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  const active = new Set<AbortController>();
  const shuttingDown = () => state === 'closing' || state === 'closed';
  const service: McpServer = {
    start() {
      if (state === 'closing' || state === 'closed') return Promise.reject(new GraphError('CG_GRAPH_CLOSED', 'lifecycle', 'MCP server is closed', 'check_config'));
      if (startPromise) return startPromise;
      state = 'starting';
      startPromise = (async () => {
        try {
          if (options.transport === 'stdio') {
            const transport = new StdioServerTransport(); stdio = serveStdio(factory, { legacy: 'serve', transport });
            const previous = transport.onclose; transport.onclose = () => { previous?.(); void service.close(); };
            address = { transport: 'stdio' };
          } else {
            handler = createMcpHandler(factory, { legacy: 'reject' });
            listener = createServer((req, res) => { void handleHttp(req, res); });
            listener.listen(port, host); await once(listener, 'listening');
            const bound = listener.address(); if (!bound || typeof bound === 'string') throw new Error('No HTTP address');
            const boundHost = bound.address.includes(':') ? '[' + bound.address + ']' : bound.address;
            address = { transport: 'http', host: bound.address, port: bound.port, path: route, url: `http://${boundHost}:${bound.port}${route}` };
          }
          if (shuttingDown()) throw new GraphError('CG_GRAPH_CLOSED', 'lifecycle', 'MCP closed during startup', 'check_config');
          state = 'running'; return address;
        } catch (error) {
          if (!shuttingDown()) { state = 'closed'; finish(); await handler?.close(); }
          if (error instanceof GraphError) throw error;
          throw new GraphError('CG_CONFIG_INVALID', 'config', 'MCP transport could not start', 'check_config');
        }
      })();
      return startPromise;
    },
    waitUntilClosed() { return done; },
    close() {
      if (closePromise) return closePromise;
      state = 'closing';
      closePromise = Promise.resolve().then(async () => {
        try {
          await startPromise?.catch(() => undefined);
          for (const controller of active) controller.abort(new GraphError('CG_GRAPH_CLOSED', 'lifecycle', 'MCP server is closing'));
          if (stdio) await stdio.close();
          if (listener) {
            const server = listener;
            const timer = setTimeout(() => server.closeAllConnections(), limits.shutdownTimeoutMs);
            await Promise.all([handler?.close(), new Promise<void>(resolve => server.close(() => resolve()))]); clearTimeout(timer);
          } else await handler?.close();
        } finally { state = 'closed'; finish(); }
      });
      return closePromise;
    },
  };
  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (state !== 'running') { response(res, 503, 'MCP server is not running'); return; }
    if (req.url?.split('?')[0] !== route) { response(res, 404, 'Not found'); return; }
    if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) { response(res, 405, 'Method not allowed'); return; }
    const authority = typeof req.headers.host === 'string' ? validHost(req.headers.host) : undefined;
    const repeated = (name: string) => req.rawHeaders.filter((_value, i) => i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === name).length > 1;
    if (repeated('host') || repeated('authorization')) { response(res, 400, 'Repeated authority or authentication header'); return; }
    if (!authority || !hostnames.has(authority)) { response(res, 403, 'Host is not allowed'); return; }
    if (req.headers.origin !== undefined && (typeof req.headers.origin !== 'string' || !origins.has(req.headers.origin))) { response(res, 403, 'Origin is not allowed'); return; }
    if (token) {
      const supplied = typeof req.headers.authorization === 'string' ? /^Bearer (.+)$/i.exec(req.headers.authorization)?.[1] : undefined;
      const data = supplied === undefined ? undefined : Buffer.from(supplied, 'utf8');
      if (!data || data.length !== token.length || !timingSafeEqual(data, token)) { response(res, 401, 'Authentication required'); return; }
    }
    if (active.size >= limits.maxInFlight) { response(res, 429, 'Too many in-flight requests'); return; }
    const declared = req.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > limits.maxBodyBytes)) { response(res, 413, 'Request body exceeds maxBodyBytes'); return; }
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => { controller.abort(new Error('MCP request deadline exceeded')); response(res, 504, 'Request deadline exceeded'); }, limits.requestTimeoutMs);
    const disconnect = () => { if (!res.writableFinished) controller.abort(new Error('MCP client disconnected')); };
    req.once('aborted', disconnect); res.once('close', disconnect);
    try {
      const body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []; let count = 0;
        const clean = () => { req.off('data', data); req.off('end', end); req.off('error', error); controller.signal.removeEventListener('abort', abort); };
        const data = (chunk: Buffer) => {
          count += chunk.length;
          if (count > limits.maxBodyBytes) { clean(); req.pause(); response(res, 413, 'Request body exceeds maxBodyBytes'); res.once('finish', () => req.destroy()); reject(new Error('Body too large')); }
          else chunks.push(chunk);
        };
        const end = () => { clean(); resolve(Buffer.concat(chunks, count)); };
        const error = () => { clean(); reject(new Error('Body interrupted')); };
        const abort = () => { clean(); req.pause(); reject(new Error('Request aborted')); };
        req.on('data', data); req.once('end', end); req.once('error', error); controller.signal.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted) abort();
      });
      if (controller.signal.aborted) return;
      const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value); else if (value) for (const item of value) headers.append(key, item);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method!, headers, ...(body.length && req.method !== 'GET' ? { body: new Uint8Array(body) } : {}), signal: controller.signal });
      const result = await handler!.fetch(request);
      if (controller.signal.aborted || res.destroyed) { await result.body?.cancel(); return; }
      result.headers.forEach((value, key) => res.setHeader(key, value)); res.writeHead(result.status);
      const reader = result.body?.getReader(); let sent = 0;
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          sent += value.length;
          if (sent > limits.maxResponseBytes) { controller.abort(); await reader.cancel(); res.destroy(); return; }
          if (!res.write(value)) await once(res, 'drain', { signal: controller.signal });
        }
      } finally { reader.releaseLock(); }
      res.end();
    } catch { if (!res.destroyed && !res.writableEnded) response(res, controller.signal.aborted ? 504 : 400, controller.signal.aborted ? 'Request terminated' : 'Invalid MCP request'); }
    finally { clearTimeout(timer); active.delete(controller); req.off('aborted', disconnect); res.off('close', disconnect); }
  }
  return service;
}
