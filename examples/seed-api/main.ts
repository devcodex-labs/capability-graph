import { fileURLToPath, pathToFileURL } from "node:url";
import { CapabilityGraph } from "@devcodex/capability-graph";

// This example runs after tsc emits dist-test/examples/seed-api/main.js.
export const seedProviderRoot = fileURLToPath(new URL("../../../examples/seed-provider/", import.meta.url));
export async function runSeedTask(options: {
  rootDir?: string;
} = {}) {
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
    providers: [{ providerId: "seed.http", authority: { kind: "file", definitionLayout: "directory" as const, rootDir: options.rootDir ?? seedProviderRoot } }],
  });
  try {
    const provider = graph.forProvider("seed.http");
    const providers = await graph.listProviders();
    const catalog = await provider.listCatalog();
    const revision = catalog.meta.staticRevision!;
    const detail = await provider.getCapabilities(["route.validation"], { requiredStaticRevision: revision });
    const neighbors = await provider.getNeighbors("route.validation", { requiredStaticRevision: revision });
    const selection = await provider.resolveSelection({ selected: ["route.validation"], requiredStaticRevision: revision });
    const selected = selection.resolved.map((id) => id.capabilityId);
    const documents = await provider.readDocuments({ selected, roles: ["guide", "reference"], locales: ["en"], requiredStaticRevision: revision });
    const specification = await provider.readSpecification({ knowledgeIds: ["SPEC-01"], locales: ["en"], requiredStaticRevision: revision });
    return { providers, catalog, detail, neighbors, selection, selected, documents, specification };
  } finally { await graph.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(await runSeedTask(), null, 2));
}
