import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CapabilityGraph, CapabilityGraphError, type RuntimeAdapter } from "@devcodex/capability-graph";
import { createSeedServer } from "../src/server.js";

const root = fileURLToPath(new URL("../../../seed-provider/", import.meta.url));
const canonical = (capabilityId: string) => ({ providerId: "seed.http", capabilityId });
function payload(value: Awaited<ReturnType<Client["callTool"]>>) {
  const content = value.content as { type: string; text: string }[];
  assert.equal(content[0]?.type, "text");
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}
async function connected(run: (client: Client, graph: CapabilityGraph) => Promise<void>, adapter?: RuntimeAdapter) {
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", definitionLayout: "directory" as const, rootDir: root } }], runtimeAdapters: adapter ? [adapter] : [] });
  const server = createSeedServer(graph, root);
  const client = new Client({ name: "protocol-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try { await server.connect(a); await client.connect(b); await run(client, graph); }
  finally { await client.close(); await server.close(); await graph.close(); }
}
test("MCP: initialize and enumerate query tools, not one tool per capability", async () => connected(async (client) => {
  const list = await client.listTools();
  assert.equal(list.tools.length, 14);
  assert.ok(list.tools.every((tool) => tool.name.startsWith("example_")));
  assert.equal(JSON.stringify(list).includes("D-02"), false);
}));
test("MCP: static and document queries exactly match the same Core API", async () => connected(async (client, graph) => {
  const checks: [string, Record<string, unknown>, unknown][] = [
    ["example_list_providers", {}, await graph.listProviders()],
    ["example_list_catalog", { limit: 2 }, await graph.listCatalog({ limit: 2 })],
    ["example_get_capabilities", { ids: [canonical("route.validation")] }, await graph.getCapabilities([canonical("route.validation")])],
    ["example_get_neighbors", { qualifiedId: "seed.http::route.validation" }, await graph.getNeighbors(canonical("route.validation"))],
    ["example_resolve_selection", { selected: [canonical("route.validation")] },
      await graph.resolveSelection({ selected: [canonical("route.validation")] })],
    ["example_list_specification_documents", { providerId: "seed.http" }, await graph.listSpecificationDocuments({ providerId: "seed.http" })],
    ["example_read_specification", { providerId: "seed.http", knowledgeIds: ["SPEC-01"] },
      await graph.readSpecification({ providerId: "seed.http", knowledgeIds: ["SPEC-01"] })],
    ["example_read_documents", { selected: [canonical("route.validation"), canonical("schema.request")] },
      await graph.readDocuments({ selected: [canonical("route.validation"), canonical("schema.request")] })],
    ["example_read_document_page", { capability: canonical("route.validation"), knowledgeId: "D-02", maxBytes: 20 },
      await graph.readDocumentPage({ capability: canonical("route.validation"), knowledgeId: "D-02", maxBytes: 20 })],
    ["example_read_specification_page", { providerId: "seed.http", knowledgeId: "SPEC-01", maxBytes: 20 },
      await graph.readSpecificationPage({ providerId: "seed.http", knowledgeId: "SPEC-01", maxBytes: 20 })],
  ];
  for (const [name, args, expected] of checks) {
    const actual = await client.callTool({ name, arguments: args });
    assert.notEqual(actual.isError, true); assert.deepEqual(payload(actual), expected);
    if (name === "example_read_documents") assert.ok((payload(actual).results as { ok: boolean }[]).every((entry) => entry.ok));
    assert.equal(JSON.stringify(actual).includes(root), false);
  }
}));
test("MCP: scope and revision errors preserve Core codes", async () => connected(async (client, graph) => {
  for (const query of [{ requestProviderScope: ["not.allowed"] }, { requiredStaticRevision: "s:0000000000000000" }]) {
    let code: string | undefined;
    try { await graph.listCatalog(query); } catch (error) { assert.ok(error instanceof CapabilityGraphError); code = error.code; }
    const result = await client.callTool({ name: "example_list_catalog", arguments: query });
    assert.equal(result.isError, true); assert.equal(payload(result).code, code);
    assert.equal(JSON.stringify(result).includes(root), false);
  }
}));
test("MCP: batch failures retain slots and optional backends stay explicit", async () => connected(async (client, graph) => {
  const ids = [canonical("route"), canonical("missing")];
  assert.deepEqual(payload(await client.callTool({ name: "example_get_capabilities", arguments: { ids } })), await graph.getCapabilities(ids));
  for (const [name, args, code] of [
    ["example_retrieve_capabilities", { text: "validation" }, "CG_RETRIEVER_UNCONFIGURED"],
    ["example_query_knowledge", { text: "validation", selected: [canonical("route.validation")] }, "CG_RETRIEVER_UNCONFIGURED"],
    ["example_query_runtime", { project: "example", environment: "test" }, "CG_RUNTIME_DISABLED"],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true); assert.equal(payload(result).code, code);
  }
}));
test("MCP: Provider owns the specification resource", async () => connected(async (client) => {
  assert.equal((await client.listResources()).resources.length, 1);
  const value = await client.readResource({ uri: "seed://provider/specification" });
  assert.ok("text" in value.contents[0]!); assert.equal(value.contents[0]?.mimeType, "text/markdown");
}));

test("MCP F-18: real HTTP source passes through the same Runtime and knowledge primitives", async (context) => {
  // Root tests compile the independent service; these helpers never enter package exports.
  const adapterModule = new URL("../../../../dist-test/examples/seed-runtime/adapter.js", import.meta.url).href;
  const helperModule = new URL("../../../../dist-test/test/contract/http-service-process.js", import.meta.url).href;
  const { HttpRuntimeAdapter } = await import(adapterModule) as { HttpRuntimeAdapter: new (options: { endpoint: string }) => RuntimeAdapter };
  const { launchService } = await import(helperModule) as { launchService: (config: { project: string; environment: string; staticRevision: string; buildId: string }, context: unknown) =>
    Promise<{ url: string; stop(): Promise<void> }> };
  let revision = "";
  await connected(async (_client, graph) => { revision = (await graph.getProvider("seed.http")).staticRevision; });
  const service = await launchService({ project: "mcp-app", environment: "test", staticRevision: revision, buildId: "mcp-build" }, context);
  try {
    await connected(async (client) => {
      const runtime = await client.callTool({ name: "example_query_runtime", arguments: { project: "mcp-app", environment: "test" } });
      assert.notEqual(runtime.isError, true); assert.equal((payload(runtime).items as unknown[]).length, 2);
      const documents = payload(await client.callTool({ name: "example_read_documents", arguments: { selected: [canonical("route.validation")] } }));
      assert.ok((documents.results as { ok: boolean }[]).every((entry) => entry.ok));
      const wrong = await client.callTool({ name: "example_query_runtime", arguments: { project: "mcp-app", environment: "wrong" } });
      assert.equal(wrong.isError, true); assert.equal(payload(wrong).code, "CG_RUNTIME_UNAVAILABLE");
    }, new HttpRuntimeAdapter({ endpoint: `${service.url}/__capabilities/runtime` }));
  } finally { await service.stop(); }
});
test("MCP: actual stdio child serves requests and exits on close", async (context) => {
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../src/main.js", import.meta.url))], stderr: "pipe" });
  let pid: number | null = null;
  try {
    await client.connect(transport); pid = transport.pid; assert.ok(pid);
    assert.equal((await client.listTools()).tools.length, 14);
    const result = payload(await client.callTool({ name: "example_list_catalog", arguments: {} }));
    assert.equal((result.items as unknown[]).length, 5);
  } finally { await client.close(); await transport.close(); }
  assert.ok(pid); assert.throws(() => process.kill(pid!, 0));
  context.diagnostic(`stdio child PID=${pid}; transport closed; process absent; no TCP listener`);
});

test("MCP docs: page-restored main entry runs the progressive stdio chain and preserves failures", async (context) => {
  const privateRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const websiteRoot = path.resolve(fileURLToPath(new URL("../../../../website/", import.meta.url)));
  const repositoryRoot = path.dirname(websiteRoot);
  const helperUrl = pathToFileURL(path.join(repositoryRoot, "scripts/validation/website/lib/tutorial.mjs")).href;
  const { loadTutorial, materializeTutorial, compareFixture } = await import(helperUrl);
  const { artifactsRoot, createTemporaryDirectory } = await import(pathToFileURL(path.join(repositoryRoot, "scripts/lib/website-paths.mjs")).href);
  const { installLocalConsumer } = await import(pathToFileURL(path.join(repositoryRoot, "scripts/validation/website/lib/consumer.mjs")).href);
  const allocation = await createTemporaryDirectory(".docs-main-");
  // Preserve the documented layout in an independent installed consumer.
  const scratch = path.join(allocation, "examples/seed-mcp/docs-main");
  let pid: number | null = null;
  try {
    await mkdir(scratch, { recursive: true });
    await cp(root, path.join(allocation, "examples/seed-provider"), { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(privateRoot, "package.json"), "utf8"));
    await installLocalConsumer(allocation, { dependencies: [
      `@modelcontextprotocol/sdk@${manifest.dependencies["@modelcontextprotocol/sdk"]}`,
      `zod@${manifest.dependencies.zod}`
    ] });
    const tutorial = await loadTutorial("MCP");
    await compareFixture(tutorial, path.join(repositoryRoot, "test/fixtures/website/mcp-main-entry"));
    const materialized = await materializeTutorial(scratch, tutorial);
    const output = JSON.parse(execFileSync(process.execPath, [materialized.script], {
      cwd: scratch, encoding: "utf8", timeout: 30_000,
    }));
    assert.deepEqual(output, tutorial.expected);

    const client = new Client({ name: "docs-stdio", version: "0.1.0" });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [path.join(scratch, "server.mjs")], stderr: "pipe" });
    try {
      await client.connect(transport); pid = transport.pid; assert.ok(pid);
      assert.equal((await client.listTools()).tools.length, 5);
      const main = payload(await client.callTool({ name: "example_list_main_capabilities", arguments: {} }));
      assert.deepEqual((main.capabilities as { id: { capabilityId: string } }[]).map((item) => item.id.capabilityId), ["route"]);
      const serialized = JSON.stringify(main);
      for (const forbidden of ["neighborSummaries", "knowledge", "observation", "D-02", "route.validation"]) {
        assert.equal(serialized.includes(forbidden), false, `main entry leaks ${forbidden}`);
      }
      const R = main.staticRevision as string;
      assert.equal(typeof R, "string");
      const wrong = await client.callTool({ name: "example_get_capabilities",
        arguments: { ids: [canonical("route")], requiredStaticRevision: "s:0000000000000000" } });
      assert.equal(wrong.isError, true); assert.equal(payload(wrong).code, "CG_REVISION_MISMATCH");
      assert.equal(payload(wrong).nextAction, "refresh");
      const unselected = payload(await client.callTool({ name: "example_read_documents", arguments: {
        selected: [canonical("route")], knowledgeIds: ["D-02"], requiredStaticRevision: R,
      } }));
      assert.equal((unselected.results as { ok: boolean }[])[0]?.ok, false);
      assert.equal(JSON.stringify(unselected).includes("# Route Validation"), false);
      const malformed = await client.callTool({ name: "example_resolve_selection",
        arguments: { selected: ["route.validation"] } });
      assert.equal(malformed.isError, true);
      assert.match(JSON.stringify(malformed.content), /Invalid arguments|invalid_type|Expected object/i);
      const singleRevision = await client.callTool({ name: "example_resolve_selection",
        arguments: { selected: [canonical("route.validation")], requiredStaticRevisionByProvider: R } });
      assert.equal(singleRevision.isError, true);
      assert.match(JSON.stringify(singleRevision.content), /Invalid arguments|invalid_type|Expected object/i);
      const incompleteRevisionMap = await client.callTool({ name: "example_resolve_selection",
        arguments: { selected: [canonical("route.validation")], requiredStaticRevisionByProvider: {} } });
      assert.equal(incompleteRevisionMap.isError, true);
      assert.equal(payload(incompleteRevisionMap).code, "CG_INPUT_INVALID");
    } finally { try { await client.close(); } finally { await transport.close(); } }
    assert.ok(pid); assert.throws(() => process.kill(pid!, 0));

    // Missing configured main entries retain their failed slots instead of becoming an empty success.
    const { createMainEntryServer } = await import(pathToFileURL(path.join(scratch, "server.mjs")).href);
    const missing = await createMainEntryServer({ mainEntries: ["missing"] });
    const missingClient = new Client({ name: "docs-missing", version: "0.1.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await missing.server.connect(a); await missingClient.connect(b);
      const response = payload(await missingClient.callTool({ name: "example_list_main_capabilities", arguments: {} }));
      const slots = response.capabilities as { ok: boolean; error: { code: string } }[];
      assert.equal(slots.length, 1); assert.equal(slots[0]?.ok, false);
      assert.equal(slots[0]?.error.code, "CG_NOT_FOUND");
    } finally {
      try { await missingClient.close(); } finally {
        try { await missing.server.close(); } finally { await missing.graph.close(); }
      }
    }
    context.diagnostic(`page-only MCP chain passed; child PID=${pid} absent; no TCP listener`);
  } finally {
    assert.equal(path.dirname(allocation), artifactsRoot);
    assert(path.basename(allocation).startsWith(".docs-main-"));
    await rm(allocation, { recursive: true, force: true });
  }
});
