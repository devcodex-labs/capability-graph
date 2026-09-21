import { fileURLToPath } from "node:url";
import { CapabilityGraph } from "@devcodex/capability-graph";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSeedServer } from "./server.js";

const rootDir = fileURLToPath(new URL("../../../seed-provider/", import.meta.url));
const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
  providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir } }] });
const server = createSeedServer(graph, rootDir);
let closed = false;
async function close() { if (closed) return; closed = true; try { await server.close(); } finally { await graph.close(); } }
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
process.stdin.once("end", () => { void close(); });
try { await server.connect(new StdioServerTransport()); }
catch { await close(); process.exitCode = 1; }
