import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { CapabilityGraph } from "../src/index.js";
import { createCapabilityGraphToolkit, type ToolCallResult } from "../src/mcp/index.js";

const seedRoot = path.resolve("examples/seed-provider");
const identity = { providerId: "seed.http", capabilityId: "route.validation" };
const code = (result: ToolCallResult) => (result.structuredContent.error as { code: string }).code;
async function fixture(run: (graph: CapabilityGraph) => Promise<void>) {
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: seedRoot, definitionLayout: "directory" } }] });
  try { await run(graph); } finally { await graph.close(); }
}

test("the twelve JSON definitions are frozen; invalid input never invokes getters or changes the caller", async () => fixture(async graph => {
  const toolkit = createCapabilityGraphToolkit(graph); const definitions = toolkit.listTools();
  assert.equal(definitions.length, 12); assert(Object.isFrozen(definitions)); assert(Object.isFrozen(definitions[0]!.inputSchema));
  for (const tool of definitions) assert.equal(tool.inputSchema.additionalProperties, false);
  let getterCalls = 0; const getter = { get providerId() { getterCalls++; return "seed.http"; } };
  assert.equal(code(await toolkit.callTool("capability_graph_get_provider", getter)), "CG_TOOL_INPUT_INVALID"); assert.equal(getterCalls, 0);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  for (const input of [null, undefined, [], circular, { signal: new AbortController().signal }, { limit: "1" }, { unknown: true }, { parent: "seed.http::route" }])
    assert.equal(code(await toolkit.callTool("capability_graph_list_catalog", input)), "CG_TOOL_INPUT_INVALID");
  const input = Object.freeze({ limit: 1, requestProviderScope: Object.freeze(["seed.http"]) });
  const before = JSON.stringify(input); assert.equal((await toolkit.callTool("capability_graph_list_catalog", input)).isError, false);
  assert.equal(JSON.stringify(input), before);
  assert.equal(code(await toolkit.callTool("unknown", {})), "CG_TOOL_UNKNOWN");
}));

test("all twelve tools return the unchanged Core value in equivalent JSON representations", async () => fixture(async graph => {
  const toolkit = createCapabilityGraphToolkit(graph);
  const calls: readonly [string, object, () => Promise<object>][] = [
    ["list_providers", {}, () => graph.listProviders()],
    ["get_provider", { providerId: "seed.http" }, () => graph.getProvider("seed.http")],
    ["list_specification_documents", { providerId: "seed.http" }, () => graph.listSpecificationDocuments({ providerId: "seed.http" })],
    ["list_catalog", {}, () => graph.listCatalog()],
    ["get_capabilities", { ids: [identity] }, () => graph.getCapabilities([identity])],
    ["list_knowledge_members", { capability: identity, collectionId: "examples" }, () => graph.listKnowledgeMembers({ capability: identity, collectionId: "examples" })],
    ["get_neighbors", { capability: identity }, () => graph.getNeighbors(identity)],
    ["resolve_selection", { selected: [identity] }, () => graph.resolveSelection({ selected: [identity] })],
    ["read_documents", { selected: [identity], knowledgeIds: ["D-02"] }, () => graph.readDocuments({ selected: [identity], knowledgeIds: ["D-02"] })],
    ["read_document_page", { capability: identity, knowledgeId: "D-02" }, () => graph.readDocumentPage({ capability: identity, knowledgeId: "D-02" })],
    ["read_specification", { providerId: "seed.http" }, () => graph.readSpecification({ providerId: "seed.http" })],
    ["read_specification_page", { providerId: "seed.http", knowledgeId: "SPEC-01" }, () => graph.readSpecificationPage({ providerId: "seed.http", knowledgeId: "SPEC-01" })],
  ];
  for (const [suffix, input, core] of calls) {
    const output = await toolkit.callTool("capability_graph_" + suffix, input);
    const expected = await core().catch(error => ({ error: { code: error.code, message: error.message, nextAction: error.nextAction,
      ...(error.details ? { details: error.details } : {}) } }));
    assert.deepEqual(output.structuredContent, expected, suffix);
    assert.deepEqual(JSON.parse(output.content[0]!.text), expected, suffix);
  }
}));

test("toolkit scope protects discovery, point reads, pages, metadata and continuation", async () => fixture(async graph => {
  assert.throws(() => createCapabilityGraphToolkit(graph, { allowedProviders: ["outside"] }), { code: "CG_SCOPE_DENIED" });
  const empty = createCapabilityGraphToolkit(graph, { allowedProviders: [] });
  assert.deepEqual((await empty.callTool("capability_graph_list_catalog", {})).structuredContent.items, []);
  for (const [suffix, input] of [
    ["get_provider", { providerId: "seed.http" }], ["get_neighbors", { capability: identity }],
    ["read_document_page", { capability: identity, knowledgeId: "D-02" }],
    ["read_specification", { providerId: "seed.http" }], ["list_catalog", { requestProviderScope: ["seed.http"] }],
  ] as const) assert.equal(code(await empty.callTool("capability_graph_" + suffix, input)), "CG_SCOPE_DENIED");
  const restricted = await empty.callTool("capability_graph_get_capabilities", { ids: [identity] });
  assert.equal(restricted.isError, false); assert.deepEqual(restricted.structuredContent.meta && (restricted.structuredContent.meta as { scope: string[] }).scope, []);
  const toolkit = createCapabilityGraphToolkit(graph); const page = await toolkit.callTool("capability_graph_list_catalog", { limit: 1 });
  const continued = await toolkit.callTool("capability_graph_list_catalog", { limit: 1, cursor: page.structuredContent.nextCursor, requestProviderScope: [] });
  assert.equal(continued.isError, true);
}));

test("partial slots remain successful calls; budgets never truncate a JSON body", async () => fixture(async graph => {
  const toolkit = createCapabilityGraphToolkit(graph);
  const output = await toolkit.callTool("capability_graph_get_capabilities", { ids: [identity, { ...identity, capabilityId: "missing" }, identity] });
  assert.equal(output.isError, false); const slots = output.structuredContent.results as { inputIndex: number; ok: boolean }[];
  assert.deepEqual(slots.map(slot => slot.ok), [true, false, true]); assert.deepEqual(slots.map(slot => slot.inputIndex), [0, 1, 2]);
  const tiny = createCapabilityGraphToolkit(graph, { maxToolResultBytes: 512 });
  const oversized = await tiny.callTool("capability_graph_read_documents", { selected: [identity] });
  assert.equal(code(oversized), "CG_TOOL_RESULT_TOO_LARGE"); assert.deepEqual(JSON.parse(oversized.content[0]!.text), oversized.structuredContent);
  const bytes = Buffer.byteLength(JSON.stringify(output));
  const exact = createCapabilityGraphToolkit(graph, { maxToolResultBytes: bytes });
  assert.equal((await exact.callTool("capability_graph_get_capabilities", { ids: [identity, { ...identity, capabilityId: "missing" }, identity] })).isError, false);
}));

test("host cancellation is projected independently of model arguments", async () => fixture(async graph => {
  const toolkit = createCapabilityGraphToolkit(graph); const controller = new AbortController(); controller.abort(new Error("private reason"));
  const output = await toolkit.callTool("capability_graph_read_documents", { selected: [identity] }, { signal: controller.signal });
  assert.equal(code(output), "CG_TOOL_CANCELLED"); assert.equal(JSON.stringify(output).includes("private reason"), false);
  assert.equal((await graph.listCatalog()).items.length, 5, "toolkit does not close the borrowed graph");
}));

test("prefixes are configurable without changing the fixed query surface", async () => fixture(async graph => {
  const toolkit = createCapabilityGraphToolkit(graph, { namePrefix: "custom_" });
  assert.equal(toolkit.listTools()[0]!.name, "custom_list_providers"); assert.equal((await toolkit.callTool("custom_list_providers", {})).isError, false);
  for (const namePrefix of ["bad prefix", "x".repeat(129)]) assert.throws(() => createCapabilityGraphToolkit(graph, { namePrefix }));
}));
