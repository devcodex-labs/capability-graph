import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CapabilityGraph, CapabilityGraphError } from "@devcodex/capability-graph";
import { createCapabilityGraphToolkit } from "@devcodex/capability-graph/mcp";

/** SDK v1 host: shared JSON query tools and a Provider-owned Specification resource coexist. The caller owns graph lifetime. */
export function createSeedServer(graph: CapabilityGraph, _providerRoot: string): Server {
  const toolkit = createCapabilityGraphToolkit(graph, { namePrefix: "example_" });
  const server = new Server({ name: "seed-http", version: "0.1.0" }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolkit.listTools().map(tool => ({ ...tool, inputSchema: tool.inputSchema as { type: "object" } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    // A host with its own tools merges names here before falling through; do not overwrite an existing host handler.
    const output = await toolkit.callTool(request.params.name, request.params.arguments ?? {}, { signal: extra.signal });
    return { ...output, content: [...output.content] };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    { name: "provider-specification", uri: "seed://provider/specification", mimeType: "text/markdown" },
  ] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== "seed://provider/specification") throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
    const batch = await graph.forProvider("seed.http").readSpecification({ knowledgeIds: ["SPEC-01"] });
    const slot = batch.results[0];
    if (!slot || !slot.ok) throw new CapabilityGraphError(slot && !slot.ok ? slot.error.code : "CG_NOT_FOUND", { nextAction: "repair_source" });
    return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: slot.value.text }] };
  });
  return server;
}
