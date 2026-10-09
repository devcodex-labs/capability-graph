import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CapabilityGraph, KnowledgeMembersPage, QueryKnowledgePage, RetrieveCapabilitiesPage, DocumentReadBatch, ErrorShape } from "@devcodex/capability-graph";
import { createSeedServer } from "../src/server.js";
import { canonical, collectionId, createRetrieverGraph, fixture } from "./retrieval-fixture.js";

function payload<T>(value: Awaited<ReturnType<Client["callTool"]>>): T {
  const content = value.content as { type: string; text: string }[];
  assert.equal(content[0]?.type, "text");
  return JSON.parse(content[0]!.text) as T;
}
async function connected(run: (client: Client, graph: CapabilityGraph, mode: Awaited<ReturnType<typeof createRetrieverGraph>>["mode"], root: string) => Promise<void>) {
  await fixture(async (root) => {
    const { graph, mode } = await createRetrieverGraph(root);
    const server = createSeedServer(graph, root);
    const client = new Client({ name: "retrieval-protocol", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try { await server.connect(a); await client.connect(b); await run(client, graph, mode, root); }
    finally { try { await client.close(); } finally { try { await server.close(); } finally { await graph.close(); } } }
  });
}
const members = { qualifiedId: "seed.http::route.validation", collectionId, limit: 1 };

test("MCP: Collection pages, explicit member read and cursor mismatches preserve Core behavior", async () => connected(async (client, graph, _mode, root) => {
  const first = payload<KnowledgeMembersPage>(await client.callTool({ name: "example_list_knowledge_members", arguments: members }));
  assert.deepEqual(first, await graph.listKnowledgeMembers({ capability: canonical("route.validation"), collectionId, limit: 1 }));
  assert.equal(first.items[0]?.knowledgeId, "CM-01"); assert.ok(first.nextCursor);
  const second = payload<KnowledgeMembersPage>(await client.callTool({ name: "example_list_knowledge_members", arguments: { ...members, cursor: first.nextCursor } }));
  assert.equal(second.items[0]?.knowledgeId, "CM-02"); assert.equal(second.nextCursor, undefined);
  const read = { selected: [canonical("route.validation")], knowledgeIds: ["CM-02"] };
  assert.deepEqual(payload(await client.callTool({ name: "example_read_documents", arguments: read })), await graph.readDocuments(read));
  for (const args of [{ ...members, limit: 2, cursor: first.nextCursor }]) {
    const response = await client.callTool({ name: "example_list_knowledge_members", arguments: args });
    assert.equal(response.isError, true); assert.equal(payload<ErrorShape>(response).code, "CG_REVISION_MISMATCH");
  }
  const file = path.join(root, "route-validation.capability.json");
  const definition = JSON.parse(await readFile(file, "utf8")); definition.description += " revised";
  await writeFile(file, JSON.stringify(definition)); await graph.reload();
  const oldCursor = await client.callTool({ name: "example_list_knowledge_members", arguments: { ...members, cursor: first.nextCursor } });
  assert.equal(oldCursor.isError, true); assert.equal(payload<ErrorShape>(oldCursor).code, "CG_REVISION_MISMATCH");
}));

test("MCP: configured retrievers serialize success, partial ranks, zero hits and stale evidence", async () => connected(async (client, graph, mode) => {
  for (const value of ["good", "mixed", "zero"] as const) {
    mode.capabilities = value;
    const page = payload<RetrieveCapabilitiesPage>(await client.callTool({ name: "example_retrieve_capabilities", arguments: { text: "validation" } }));
    assert.deepEqual(page, await graph.retrieveCapabilities({ text: "validation" }));
    if (value === "mixed") { assert.deepEqual(page.items.map((item) => item.rank), [1, 3]); assert.equal(page.meta.completeness, "partial"); }
    if (value === "zero") assert.equal(page.items.length, 0);
  }
  const query = { text: "guide", selected: [canonical("route.validation")], knowledgeIds: [collectionId] };
  for (const value of ["good", "mixed", "zero"] as const) {
    mode.knowledge = value;
    const page = payload<QueryKnowledgePage>(await client.callTool({ name: "example_query_knowledge", arguments: query }));
    assert.deepEqual(page, await graph.queryKnowledge(query)); assert.equal(page.knowledgeState, "searched");
    if (value === "mixed") { assert.equal(page.items.length, 1); assert.equal(page.meta.completeness, "partial"); }
    if (value === "zero") { assert.equal(page.items.length, 0); assert.equal(page.indexStatus?.validatedDocuments, 2); }
  }
  mode.knowledge = "stale";
  const stale = await client.callTool({ name: "example_query_knowledge", arguments: query });
  assert.equal(stale.isError, true); assert.equal(payload<ErrorShape>(stale).code, "CG_INDEX_STALE");
  const denied = await client.callTool({ name: "example_retrieve_capabilities", arguments: { text: "guide", requestProviderScope: ["other"] } });
  assert.equal(denied.isError, true); assert.equal(payload<ErrorShape>(denied).code, "CG_SCOPE_DENIED");
}));

test("MCP: real stdio runs Collection/recall/search/member-read chain and releases the child", { timeout: 30000 }, async () => fixture(async (root) => {
  const client = new Client({ name: "retrieval-stdio", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("./retrieval-server.js", import.meta.url)), root], stderr: "pipe" });
  let pid: number | null = null;
  try {
    await client.connect(transport); pid = transport.pid; assert.ok(pid);
    const first = payload<KnowledgeMembersPage>(await client.callTool({ name: "example_list_knowledge_members", arguments: members }));
    const second = payload<KnowledgeMembersPage>(await client.callTool({ name: "example_list_knowledge_members", arguments: { ...members, cursor: first.nextCursor } }));
    assert.equal(first.items[0]?.knowledgeId, "CM-01"); assert.equal(second.items[0]?.knowledgeId, "CM-02");
    assert.equal(payload<RetrieveCapabilitiesPage>(await client.callTool({ name: "example_retrieve_capabilities", arguments: { text: "validation" } })).items.length, 2);
    const query = { text: "guide", selected: [canonical("route.validation")], knowledgeIds: [collectionId] };
    assert.equal(payload<QueryKnowledgePage>(await client.callTool({ name: "example_query_knowledge", arguments: query })).items.length, 2);
    const response = payload<DocumentReadBatch>(await client.callTool({ name: "example_read_documents", arguments: { selected: query.selected, knowledgeIds: ["CM-02"] } }));
    const slot = response.results[0]!; assert.ok(slot.ok); assert.equal(slot.value.text, "中文指南\n");
  } finally { try { await client.close(); } finally { await transport.close(); } }
  assert.ok(pid); assert.throws(() => process.kill(pid!, 0));
}));
