import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { Socket } from "node:net";
import { McpServer, createMcpHandler, fromJsonSchema, UnsupportedProtocolVersionError,
  type JSONRPCMessage, type Transport, type TransportSendOptions, type MessageExtraInfo, type JsonSchemaType } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { CapabilityGraph } from "../capability-graph.js";
import { createCapabilityGraphToolkit } from "./toolkit.js";
import type { ToolkitOptions } from "./types.js";

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2026-07-28"]);
/** Independent transport limits; bytes include the entire inbound JSON or outbound tool envelope. */
export interface ServerLimits {
  readonly maxClients?: number; readonly maxInFlight?: number; readonly maxBodyBytes?: number;
  /** Milliseconds in 1..2147483647, avoiding Node's overflow-to-1ms behavior. */
  readonly requestTimeoutMs?: number; readonly drainTimeoutMs?: number; readonly maxToolResultBytes?: number;
}
export interface HttpServerOptions {
  /** Default 127.0.0.1:3333/mcp. Port 0 lets the OS allocate a port for an embedded host/test. */
  readonly host?: string; readonly port?: number; readonly path?: string;
  /** Exact origins and hostnames. Missing Origin is permitted for nonbrowser clients; present Origin is always checked. */
  readonly allowedOrigins?: readonly string[]; readonly allowedHostnames?: readonly string[];
  readonly bearerToken?: string;
  /** Required explicitly for nonloopback listeners, including a legal empty scope. */
  readonly allowedProviders?: readonly string[];
  readonly limits?: ServerLimits;
}
export interface CapabilityGraphServerOptions {
  readonly graph: CapabilityGraph;
  readonly toolkitOptions?: ToolkitOptions;
  readonly transport: "stdio" | "http";
  readonly http?: HttpServerOptions;
}
export interface ServerAddress { readonly transport: "stdio" | "http"; readonly url?: string }
/** The host owns graph/Reader lifetime. start is idempotent; a closed handle cannot restart. */
export interface CapabilityGraphServer {
  start(): Promise<ServerAddress>;
  close(): Promise<void>;
}
const defaults = { maxClients: 32, maxInFlight: 64, maxBodyBytes: 1_048_576,
  requestTimeoutMs: 30_000, drainTimeoutMs: 5_000, maxToolResultBytes: 16_777_216 };
type RequestState = { controller: AbortController; done: Promise<void>; finish: () => void };
const state = (): RequestState => {
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  return { controller: new AbortController(), done, finish };
};
const loopback = (host: string) => host === "localhost" || host === "::1" || /^127\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}$/.test(host);
const bracket = (host: string) => host.includes(":") ? `[${host}]` : host;
function versionError(body: unknown, header?: string): UnsupportedProtocolVersionError | undefined {
  const message = body as { method?: string; params?: { protocolVersion?: unknown; _meta?: Record<string, unknown> } } | null;
  const versions = [header, message?.method === "initialize" ? message.params?.protocolVersion : undefined,
    message?.params?._meta?.["io.modelcontextprotocol/protocolVersion"]];
  for (const value of versions) if (value !== undefined && (typeof value !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.includes(value)))
    return new UnsupportedProtocolVersionError({ requested: String(value), supported: [...SUPPORTED_PROTOCOL_VERSIONS] });
}
function protocolFailure(body: unknown, error: UnsupportedProtocolVersionError) {
  const id = body && typeof body === "object" && "id" in body ? (body as { id: unknown }).id : null;
  return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message, data: error.data } };
}

// Only the explicit supported-version boundary is ours. Framing, era selection, validation and cancellation stay in the SDK.
class VersionGuard implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  constructor(private readonly transport: Transport, private readonly disconnected: () => void) {}
  async start() {
    this.transport.onclose = () => { this.disconnected(); this.onclose?.(); };
    this.transport.onerror = error => this.onerror?.(error);
    this.transport.onmessage = (message, extra) => {
      const error = versionError(message);
      if (error) {
        if ("id" in message) void this.transport.send(protocolFailure(message, error) as JSONRPCMessage).catch(failure => this.onerror?.(failure));
        return;
      }
      this.onmessage?.(message, extra);
    };
    await this.transport.start();
  }
  send(message: JSONRPCMessage, options?: TransportSendOptions) { return this.transport.send(message, options); }
  close() { this.disconnected(); return this.transport.close(); }
}

/** Create an import-safe handle over a borrowed graph. Each protocol instance uses the same twelve-tool toolkit. */
export function createCapabilityGraphServer(options: CapabilityGraphServerOptions): CapabilityGraphServer {
  if (!["stdio", "http"].includes(options.transport)) throw new Error("Invalid server transport");
  const http = options.http ?? {};
  const host = http.host ?? "127.0.0.1", port = http.port ?? 3333, pathname = http.path ?? "/mcp";
  if (typeof host !== "string" || !host || !Number.isSafeInteger(port) || port < 0 || port > 65535 || !/^\/[A-Za-z0-9/_-]*$/.test(pathname)) throw new Error("Invalid HTTP address");
  const limits = { ...defaults, ...http.limits };
  if (Object.keys(limits).some(key => !(key in defaults)) || !Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid server limits");
  if (limits.requestTimeoutMs > 2_147_483_647 || limits.drainTimeoutMs > 2_147_483_647) throw new Error("Server timeout exceeds the Node timer range (2147483647)");
  const origins = http.allowedOrigins === undefined ? undefined : new Set(http.allowedOrigins.map(origin => {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error("Invalid allowed Origin");
    return origin;
  }));
  const names = new Set([host.toLowerCase(), ...(http.allowedHostnames ?? []).map(name => {
    const url = new URL(`http://${bracket(name)}`);
    if (url.hostname.replace(/^\[|\]$/g, "").toLowerCase() !== name.toLowerCase() || url.port || url.username || url.password || url.pathname !== "/") throw new Error("Invalid allowed hostname");
    return name.toLowerCase();
  })]);
  const allowedProviders = http.allowedProviders ?? options.toolkitOptions?.allowedProviders;
  if (options.transport === "http" && !loopback(host) &&
    (!http.bearerToken?.trim() || !origins?.size || !http.allowedHostnames?.length || allowedProviders === undefined))
    throw new Error("Nonloopback HTTP requires token, explicit origins/hostnames and Provider scope");
  const toolkit = createCapabilityGraphToolkit(options.graph, { ...options.toolkitOptions,
    ...(allowedProviders === undefined ? {} : { allowedProviders }),
    maxToolResultBytes: http.limits?.maxToolResultBytes ?? options.toolkitOptions?.maxToolResultBytes ?? defaults.maxToolResultBytes });
  const requestContext = new AsyncLocalStorage<RequestState>();
  const requests = new Set<RequestState>();
  const calls = new Set<Promise<unknown>>();
  const shutdown = new AbortController();
  const sockets = new Set<Socket>();
  let closing = false, started: Promise<ServerAddress> | undefined, closed: Promise<void> | undefined;
  let listener: Server | undefined;
  let transportHandle: { close(): Promise<void> } | undefined;
  let endpoint = "";
  const abortRequests = () => { for (const request of requests) request.controller.abort(); shutdown.abort(); };
  const factory = () => {
    const incoming = requestContext.getStore();
    const server = new McpServer({ name: "capability-graph", version: "2.0.0" });
    for (const definition of toolkit.listTools()) server.registerTool(definition.name, {
      description: definition.description, inputSchema: fromJsonSchema(definition.inputSchema as JsonSchemaType), annotations: definition.annotations,
    }, async (arguments_, context) => {
      const signal = AbortSignal.any([context.mcpReq.signal, shutdown.signal, ...(incoming ? [incoming.controller.signal] : [])]);
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), limits.requestTimeoutMs);
      const call = toolkit.callTool(definition.name, arguments_, { signal: AbortSignal.any([signal, deadline.signal]) });
      calls.add(call);
      try { const output = await call; return { ...output, content: [...output.content] }; }
      finally { clearTimeout(timer); calls.delete(call); }
    });
    return server;
  };
  const reply = (response: ServerResponse, status: number, value: unknown) => {
    if (!response.destroyed && !response.writableEnded) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }
  };
  const handleHttp = async (request: IncomingMessage, response: ServerResponse,
    handler: ReturnType<typeof createMcpHandler>): Promise<void> => {
    let url: URL;
    try { url = new URL(request.url ?? "", "http://localhost"); } catch { reply(response, 404, { error: "Unknown path" }); return; }
    if (url.pathname !== pathname) { reply(response, 404, { error: "Unknown path" }); return; }
    if (request.method !== "POST") { response.setHeader("allow", "POST"); reply(response, 405, { error: "Method not allowed" }); return; }
    try {
      const authority = request.headers.host;
      if (!authority || authority.includes("/") || authority.includes("@")) throw new Error("Host");
      const parsed = new URL(`http://${authority}`);
      if (!names.has(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase())) throw new Error("Host");
      const origin = request.headers.origin;
      if (origin !== undefined) {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.origin !== origin || !(origins ?? new Set([new URL(endpoint).origin])).has(origin)) throw new Error("Origin");
      }
    } catch { reply(response, 403, { error: "Host or Origin denied" }); return; }
    if (http.bearerToken !== undefined) {
      const expected = Buffer.from(`Bearer ${http.bearerToken}`), actual = Buffer.from(request.headers.authorization ?? "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { reply(response, 401, { error: "Bearer token required" }); return; }
    }
    if (closing) { reply(response, 503, { error: "Server closing" }); return; }
    if (requests.size >= limits.maxInFlight) { reply(response, 429, { error: "Too many requests" }); return; }
    const operation = state(); requests.add(operation);
    let reading = true;
    const disconnect = () => { if (!response.writableFinished) operation.controller.abort(); };
    const abortBody = () => { if (reading) request.destroy(); };
    request.once("aborted", disconnect); response.once("close", disconnect);
    operation.controller.signal.addEventListener("abort", abortBody);
    const timer = setTimeout(() => operation.controller.abort(), limits.requestTimeoutMs);
    try {
      const declared = request.headers["content-length"];
      if (declared !== undefined && Number(declared) > limits.maxBodyBytes) { reply(response, 413, { error: "Body too large" }); request.resume(); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        operation.controller.signal.throwIfAborted(); bytes += chunk.length;
        if (bytes > limits.maxBodyBytes) { reply(response, 413, { error: "Body too large" }); return; }
        chunks.push(Buffer.from(chunk));
      }
      reading = false; operation.controller.signal.throwIfAborted();
      let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
      catch { reply(response, 400, { error: "Invalid JSON" }); return; }
      const header = request.headers["mcp-protocol-version"];
      const error = versionError(body, typeof header === "string" ? header : undefined);
      if (error) { reply(response, 400, protocolFailure(body, error)); return; }
      // The official adapter reads an already bounded parsed body and preserves socket-close cancellation.
      await requestContext.run(operation, () => toNodeHandler(handler)(request, response, body));
    } catch (error) {
      if (!operation.controller.signal.aborted) reply(response, 500, { error: "MCP request failed" });
    } finally {
      clearTimeout(timer); request.removeListener("aborted", disconnect); response.removeListener("close", disconnect);
      operation.controller.signal.removeEventListener("abort", abortBody); operation.finish(); requests.delete(operation);
    }
  };
  return Object.freeze({
    start() {
      if (closing) return Promise.reject(new Error("Server is closed"));
      return started ??= (async () => {
        if (options.transport === "stdio") {
          transportHandle = serveStdio(factory, { legacy: "serve", maxSubscriptions: 0,
            transport: new VersionGuard(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: limits.maxBodyBytes }), abortRequests) });
          return { transport: "stdio" as const };
        }
        const handler = createMcpHandler(factory, { legacy: "stateless", responseMode: "sse", maxSubscriptions: 0 });
        transportHandle = handler;
        listener = createServer((request, response) => { void handleHttp(request, response, handler).catch(() => response.destroy()); });
        listener.on("connection", socket => {
          if (closing || sockets.size >= limits.maxClients) { socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n", () => socket.destroy()); return; }
          sockets.add(socket); socket.once("close", () => sockets.delete(socket));
        });
        await new Promise<void>((resolve, reject) => { listener!.once("error", reject); listener!.listen(port, host, () => { listener!.removeListener("error", reject); resolve(); }); });
        const address = listener.address(); if (!address || typeof address === "string") throw new Error("Missing server address");
        endpoint = `http://${bracket(host)}:${address.port}${pathname}`;
        return { transport: "http" as const, url: endpoint };
      })();
    },
    close() {
      return closed ??= (async () => {
        closing = true;
        await started?.catch(() => {});
        const stopped = listener?.listening ? new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve())) : Promise.resolve();
        // A drain deadline aborts real I/O; we still await its cleanup and never treat the timer as completed work.
        const timer = setTimeout(abortRequests, limits.drainTimeoutMs);
        try {
          await Promise.all([...requests].map(request => request.done));
          await Promise.allSettled([...calls]);
        } finally { clearTimeout(timer); abortRequests(); }
        await transportHandle?.close();
        for (const socket of sockets) socket.destroy();
        await stopped;
      })();
    },
  });
}
