import { fileURLToPath, pathToFileURL } from "node:url";
import { CapabilityGraph, type RuntimeAdapter } from "@devcodex-labs/capability-graph";

// This example runs after tsc emits dist-test/examples/seed-api/main.js.
export const seedProviderRoot = fileURLToPath(new URL("../../../examples/seed-provider/", import.meta.url));
export async function runSeedTask(options: {
  rootDir?: string;
  runtime?: { adapter: RuntimeAdapter; project: string; environment: string };
} = {}) {
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: options.rootDir ?? seedProviderRoot } }],
    runtimeAdapters: options.runtime ? [options.runtime.adapter] : [],
  });
  try {
    const provider = graph.forProvider("seed.http");
    const providers = await graph.listProviders();
    const catalog = await provider.listCatalog();
    const revision = catalog.meta.staticRevision!;
    const detail = await provider.getCapabilities(["route.validation"], { requiredStaticRevision: revision });
    const neighbors = await provider.getNeighbors("route.validation", { requiredStaticRevision: revision });
    const selected = ["route.validation", "schema.request"];
    const runtime = options.runtime ? await provider.queryRuntime({ project: options.runtime.project,
      environment: options.runtime.environment, instanceOf: { capabilityId: "route.http" }, requiredStaticRevision: revision }) : undefined;
    const documents = await provider.readDocuments({ selected, requiredStaticRevision: revision });
    return { providers, catalog, detail, neighbors, selected, ...(runtime === undefined ? {} : { runtime }), documents };
  } finally { await graph.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await runSeedTask(), null, 2));
}
