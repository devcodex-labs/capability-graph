import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapabilityGraph, CapabilityGraphError, parseQualifiedId } from "@devcodex-labs/capability-graph";

const id = z.object({ providerId: z.string(), capabilityId: z.string() });
const scope = { requestProviderScope: z.array(z.string()).optional(), requiredStaticRevision: z.string().optional() };
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
async function call(operation: () => Promise<unknown>) {
  try { return result(await operation()); }
  catch (error) {
    const known = error instanceof CapabilityGraphError;
    return { ...result({ code: known ? error.code : "CG_PARTIAL_ITEM", message: known ? error.message : "The query failed.",
      nextAction: known ? error.nextAction : "repair_source", ...(known && error.details ? { details: error.details } : {}) }), isError: true };
  }
}

/** Tool names belong to this Provider example; the library has no MCP registry. */
export function createSeedServer(graph: CapabilityGraph, providerRoot: string): McpServer {
  const server = new McpServer({ name: "seed-http", version: "0.1.0" });
  server.registerTool("example_list_providers", { description: "List enabled Provider metadata.", inputSchema: scope },
    (query) => call(() => graph.listProviders(query)));
  server.registerTool("example_list_catalog", { description: "Browse static capabilities within an explicit scope and budget.", inputSchema: {
    ...scope, limit: z.number().int().positive().optional(), cursor: z.string().optional(), capabilityIdPrefix: z.string().optional(), parent: id.optional(),
  } }, (query) => call(() => graph.listCatalog(query)));
  server.registerTool("example_get_capabilities", { description: "Read bounded details for explicitly identified capabilities.", inputSchema: {
    ids: z.array(id), requiredStaticRevision: z.string().optional(), neighborLimitPerKind: z.number().int().nonnegative().optional(), knowledgeLimit: z.number().int().positive().optional(),
    knowledgeCursors: z.record(z.string()).optional(),
  } }, ({ ids, ...query }) => call(() => graph.getCapabilities(ids, query)));
  server.registerTool("example_get_neighbors", { description: "Browse declared graph relations without implicitly selecting them.", inputSchema: {
    qualifiedId: z.string(), requiredStaticRevision: z.string().optional(), limitPerKind: z.number().int().positive().optional(),
    kinds: z.array(z.enum(["parents", "children", "specializes", "specializedBy", "related", "relatedBy"])).optional(),
    cursors: z.object({ parents: z.string().optional(), children: z.string().optional(), specializes: z.string().optional(),
      specializedBy: z.string().optional(), related: z.string().optional(), relatedBy: z.string().optional() }).optional(),
  } }, ({ qualifiedId, ...query }) => call(() => graph.getNeighbors(parseQualifiedId(qualifiedId), query)));
  server.registerTool("example_read_documents", { description: "Read documents declared by the selected capabilities.", inputSchema: {
    ...scope, selected: z.array(id), knowledgeIds: z.array(z.string()).optional(),
  } }, (query) => call(() => graph.readDocuments(query)));
  server.registerTool("example_retrieve_capabilities", { description: "Explicitly invoke the configured capability retriever.", inputSchema: {
    ...scope, text: z.string(), limit: z.number().int().positive().optional(),
  } }, (query) => call(() => graph.retrieveCapabilities(query)));
  server.registerTool("example_query_knowledge", { description: "Search only the selected capability knowledge with a configured backend.", inputSchema: {
    ...scope, selected: z.array(id), text: z.string(), knowledgeIds: z.array(z.string()).optional(), limit: z.number().int().positive().optional(),
  } }, (query) => call(() => graph.queryKnowledge(query)));
  server.registerTool("example_query_runtime", { description: "Query observed instances in one project, environment and Provider.", inputSchema: {
    ...scope, project: z.string(), environment: z.string(), instanceOf: id.optional(), instanceId: z.string().optional(),
    requiredRuntimeRevision: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().positive().optional(),
  } }, (query) => call(() => graph.queryRuntime(query)));
  server.registerResource("provider-specification", "seed://provider/specification", { mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(path.join(providerRoot, "PROVIDER.md"), "utf8") }],
  }));
  return server;
}
