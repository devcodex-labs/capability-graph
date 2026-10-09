import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSeedServer } from "../src/server.js";
import { createRetrieverGraph } from "./retrieval-fixture.js";

const root = process.argv[2]!;
const { graph } = await createRetrieverGraph(root);
const server = createSeedServer(graph, root);
process.stdin.once("end", async () => {
  try { await server.close(); } finally { await graph.close(); }
});
await server.connect(new StdioServerTransport());
