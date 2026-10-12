import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ModernClient } from "@modelcontextprotocol/client";
import { StdioClientTransport as ModernStdioTransport } from "@modelcontextprotocol/client/stdio";
import { CapabilityGraph } from "../src/index.js";
import { createCapabilityGraphServer } from "../src/mcp/server.js";
import { HttpKnowledgeReader } from "../src/readers/http.js";
import { FileFixture, record } from "./contract/file-fixture.js";
import { assertPortReleased } from "./contract/port-released.js";

const seed = () => CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
  providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: path.resolve("examples/seed-provider"), definitionLayout: "directory" } }] });
const modernMeta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
async function post(url: string, body: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body), signal });
  return { status: response.status, body: await response.text(), headers: response.headers };
}
const modern = (method: string, params: object = {}) => ({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: modernMeta } });
const headers = (method: string, name?: string) => ({ "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...(name ? { "Mcp-Name": name } : {}) });

test("HTTP supports both protocol eras with one toolkit and borrows graph lifetime", async () => {
  const graph = await seed(); const server = createCapabilityGraphServer({ graph, transport: "http", http: { port: 0 } });
  let port = 0;
  try {
    const address = await server.start(); assert.deepEqual(await server.start(), address); const url = address.url!; port = Number(new URL(url).port);
    const list = await post(url, modern("tools/list"), headers("tools/list"));
    assert.equal(list.status, 200); assert.match(list.body, /capability_graph_read_specification_page/); assert.equal(list.headers.get("content-type")?.startsWith("text/event-stream"), true);
    const call = await post(url, modern("tools/call", { name: "capability_graph_list_catalog", arguments: {} }), headers("tools/call", "capability_graph_list_catalog"));
    assert.equal(call.status, 200); assert.match(call.body, /route.validation/);
    const client = new Client({ name: "legacy-test", version: "1" }); const transport = new StreamableHTTPClientTransport(new URL(url));
    try {
      await client.connect(transport); const tools = await client.listTools(); assert.equal(tools.tools.length, 12);
      const result = await client.callTool({ name: "capability_graph_list_catalog", arguments: {} }); assert.equal(result.isError, false);
      assert.equal(transport.sessionId, undefined);
    } finally { await client.close(); }
    for (const method of ["GET", "DELETE"]) assert.equal((await fetch(url, { method })).status, 405);
  } finally { await server.close(); await server.close(); await assertPortReleased(port); assert.equal((await graph.listCatalog()).items.length, 5); await graph.close(); }
  await assert.rejects(server.start(), /closed/);
});

test("HTTP gates path, Host/Origin, token, byte limits and exact protocol claims before Core", async () => {
  const graph = await seed(); const server = createCapabilityGraphServer({ graph, transport: "http", http: {
    port: 0, bearerToken: "secret", limits: { maxBodyBytes: 1024 } } }); let port = 0;
  try {
    const url = (await server.start()).url!; port = Number(new URL(url).port); const auth = { authorization: "Bearer secret" };
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    assert.equal((await post(url + "/bad", list)).status, 404);
    const rejectedHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(url, { method: "POST", headers: { host: "evil.test", ...auth, "content-type": "application/json" } }, response => {
        response.resume(); response.once("end", () => resolve(response.statusCode!));
      });
      request.once("error", reject); request.end(JSON.stringify(list));
    });
    assert.equal(rejectedHost, 403);
    for (const origin of ["null", "http://evil.test", "http://127.0.0.1/path"]) assert.equal((await post(url, list, { origin, ...auth })).status, 403);
    assert.equal((await post(url, list)).status, 401);
    assert.equal((await post(url, list, { ...auth, origin: new URL(url).origin })).status, 200);
    assert.equal((await post(url, { large: "x".repeat(2048) }, auth)).status, 413);
    const unknown = await post(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }, auth);
    assert.equal(unknown.status, 400); assert.match(unknown.body, /2026-07-28/); assert.match(unknown.body, /2025-11-25/);
    assert.equal((await post(url, modern("tools/list"), { ...auth, ...headers("tools/call") })).status, 400);
    assert.equal((await post(url, modern("tools/list"), { ...auth, "MCP-Protocol-Version": "2099-01-01" })).status, 400);
    assert.throws(() => createCapabilityGraphServer({ graph, transport: "http", http: { host: "0.0.0.0" } }), /Nonloopback/);
    for (const field of ["requestTimeoutMs", "drainTimeoutMs"]) assert.throws(() => createCapabilityGraphServer({ graph,
      transport: "http", http: { limits: { [field]: 2_147_483_648 } } }), /Node timer range/);
    assert.throws(() => new HttpKnowledgeReader({ allowedOrigins: ["https://example.test"], timeoutMs: 2_147_483_648 }), /Node timer range/);
  } finally { await server.close(); await graph.close(); await assertPortReleased(port); }
});

test("legacy and modern HTTP disconnect/deadline/shutdown cancel owned I/O without closing other clients", async () => {
  let arrival!: () => void; let pendingArrival = new Promise<void>(resolve => { arrival = resolve; });
  const source = createHttpServer((_request, response) => { response.writeHead(200); response.write("first"); arrival(); });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const sourcePort = (source.address() as { port: number }).port; const sourceUrl = `http://127.0.0.1:${sourcePort}`;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [sourceUrl], timeoutMs: 3000 });
  const fixture = new FileFixture([record("a", { knowledge: [{ kind: "document", knowledgeId: "slow", role: "guide", locator: { type: "http", url: sourceUrl + "/slow" } }] })]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
    providers: [{ providerId: "seed", authority: fixture.authority }], readers: [reader] });
  const server = createCapabilityGraphServer({ graph, transport: "http", http: { port: 0, limits: { drainTimeoutMs: 20, requestTimeoutMs: 500 } } }); let port = 0;
  try {
    const url = (await server.start()).url!; port = Number(new URL(url).port);
    const arguments_ = { selected: [{ providerId: "seed", capabilityId: "a" }] };
    const controller = new AbortController();
    const cancelled = assert.rejects(post(url, modern("tools/call", { name: "capability_graph_read_documents", arguments: arguments_ }), headers("tools/call", "capability_graph_read_documents"), controller.signal));
    await pendingArrival;
    const other = await post(url, modern("tools/call", { name: "capability_graph_list_catalog", arguments: {} }), headers("tools/call", "capability_graph_list_catalog"));
    assert.equal(other.status, 200); controller.abort(); await cancelled;
    const until = Date.now() + 2000; while (reader.activeRequests && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(reader.activeRequests, 0);
    pendingArrival = new Promise<void>(resolve => { arrival = resolve; });
    const legacy = post(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "capability_graph_read_documents", arguments: arguments_ } });
    await pendingArrival; await server.close(); const result = await legacy;
    assert.match(result.body, /CG_TOOL_CANCELLED/); assert.equal(reader.activeRequests, 0);
    assert.equal((await graph.listCatalog()).items.length, 1);
  } finally {
    await server.close(); await graph.close(); await reader.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
    await assertPortReleased(port); await assertPortReleased(sourcePort);
  }
});

test("stdio serves legacy SDK clients and rejects unsupported versions explicitly", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve("test/fixtures/mcp-stdio.mjs")], stderr: "pipe" });
  const client = new Client({ name: "stdio-test", version: "1" });
  try { await client.connect(transport); assert.equal((await client.listTools()).tools.length, 12);
    const result = await client.callTool({ name: "capability_graph_list_catalog", arguments: {} }); assert.equal(result.isError, false);
  } finally { await client.close(); }
  const modernTransport = new ModernStdioTransport({ command: process.execPath, args: [path.resolve("test/fixtures/mcp-stdio.mjs")], stderr: "pipe" });
  const modernClient = new ModernClient({ name: "modern-stdio", version: "1" });
  try {
    await modernClient.connect(modernTransport); assert.equal((await modernClient.listTools()).tools.length, 12);
    const result = await modernClient.callTool({ name: "capability_graph_list_catalog", arguments: {} }); assert.equal(result.isError, false);
  } finally { await modernClient.close(); }
  const child = spawn(process.execPath, [path.resolve("test/fixtures/mcp-stdio.mjs")], { stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true });
  assert(child.stdin && child.stdout && child.stderr);
  let stdout = "", stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  const timer = setTimeout(() => child.kill(), 35_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("message", () => resolve()); child.once("error", reject);
      child.once("exit", () => reject(new Error(`stdio fixture exited before readiness: ${stderr}`)));
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "unknown", version: "1" } } }) + "\n");
    const until = Date.now() + 10_000; while (!stdout.includes("\n") && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    assert(stdout.includes("\n"), `stdio did not return a complete protocol frame: ${stderr}`);
    const result = JSON.parse(stdout.split("\n")[0]!); assert.equal(result.id, 10); assert.deepEqual(result.error.data.supported, ["2025-11-25", "2026-07-28"]); assert.equal(stderr, "");
  } finally { child.stdin.end(); await exited; clearTimeout(timer); }
});

test("HTTP counts active TCP clients, including sockets that have not sent a request", async () => {
  const graph = await seed(); const server = createCapabilityGraphServer({ graph, transport: "http", http: { port: 0, limits: { maxClients: 1 } } });
  const url = (await server.start()).url!; const port = Number(new URL(url).port);
  const first = createConnection({ host: "127.0.0.1", port }); await new Promise<void>((resolve, reject) => { first.once("connect", resolve); first.once("error", reject); });
  const second = createConnection({ host: "127.0.0.1", port }); let text = "";
  second.setEncoding("utf8"); second.on("data", chunk => { text += chunk; });
  try {
    await new Promise<void>((resolve, reject) => { second.once("close", () => resolve()); second.once("error", reject); });
    assert.match(text, /429 Too Many Requests/);
  } finally { first.destroy(); second.destroy(); await server.close(); await graph.close(); await assertPortReleased(port); }
});

test("HTTP in-flight cap and actual Reader deadline leave no active I/O", async () => {
  let arrived!: () => void; const arrival = new Promise<void>(resolve => { arrived = resolve; });
  const source = createHttpServer((_request, response) => { response.writeHead(200); response.write("first"); arrived(); });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve)); const sourcePort = (source.address() as { port: number }).port;
  const reader = new HttpKnowledgeReader({ allowedOrigins: [`http://127.0.0.1:${sourcePort}`], timeoutMs: 2000 });
  const fixture = new FileFixture([record("a", { knowledge: [{ kind: "document", knowledgeId: "slow", role: "guide", locator: { type: "http", url: `http://127.0.0.1:${sourcePort}/slow` } }] })]);
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], providers: [{ providerId: "seed", authority: fixture.authority }], readers: [reader] });
  const server = createCapabilityGraphServer({ graph, transport: "http", http: { port: 0, limits: { maxInFlight: 1, requestTimeoutMs: 200 } } });
  const url = (await server.start()).url!, port = Number(new URL(url).port);
  try {
    const pending = post(url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "capability_graph_read_documents", arguments: { selected: [{ providerId: "seed", capabilityId: "a" }] } } });
    await arrival;
    assert.equal((await post(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).status, 429);
    const result = await pending; assert.match(result.body, /CG_TOOL_CANCELLED/); assert.equal(reader.activeRequests, 0);
  } finally {
    await server.close(); await graph.close(); await reader.close(); source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
    await assertPortReleased(port); await assertPortReleased(sourcePort);
  }
});
