import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CapabilityGraph, type KnowledgeHit, type KnowledgeIndexEvidence } from "@devcodex/capability-graph";

export const providerId = "seed.http";
export const canonical = (capabilityId: string) => ({ providerId, capabilityId });
export const collectionId = "PROTOCOL-COLLECTION";
export async function fixture(run: (root: string) => Promise<void>) {
  const helper = fileURLToPath(new URL('../../../../scripts/lib/artifact-paths.mjs', import.meta.url));
  const { createTemporaryDirectory } = await import(pathToFileURL(helper).href);
  const root: string = await createTemporaryDirectory('cg-mcp-retrieval-');
  try {
    await cp(fileURLToPath(new URL("../../../seed-provider/", import.meta.url)), root, { recursive: true });
    const file = path.join(root, "capabilities/route-validation.json");
    const definition = JSON.parse(await readFile(file, "utf8"));
    definition.knowledge.push({ kind: "collection", knowledgeId: collectionId,
      members: ["CM-01", "CM-02"].map((knowledgeId) => ({ kind: "document", knowledgeId, role: "guide", locale: "en",
        locator: { type: "relative-file", path: `knowledge/${knowledgeId}.txt` } })) });
    await writeFile(file, JSON.stringify(definition));
    await writeFile(path.join(root, "knowledge/CM-01.txt"), "Alpha guide\n");
    await writeFile(path.join(root, "knowledge/CM-02.txt"), "中文指南\n");
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** Controlled protocol inputs; these are not production retrieval backends. */
export async function createRetrieverGraph(root: string) {
  const mode: { capabilities: "good" | "mixed" | "zero"; knowledge: "good" | "mixed" | "zero" | "stale" } = {
    capabilities: "good", knowledge: "good",
  };
  const observedAt = new Date().toISOString();
  let indexedRevision = "";
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: [providerId], integrationEnabledProviders: [providerId],
    providers: [{ providerId, authority: { kind: "file", definitionLayout: "directory" as const, rootDir: root } }],
    capabilityRetriever: { id: "controlled-recall", async retrieve(input) {
      const names = mode.capabilities === "zero" ? [] : mode.capabilities === "mixed"
        ? ["route.validation", "missing", "schema.request"] : ["route.validation", "schema.request"];
      return { candidates: names.slice(0, input.limit).map((name) => ({
        id: canonical(name), sourceStaticRevision: indexedRevision, score: 0.8,
      })) };
    } },
    knowledgeRetriever: { id: "controlled-knowledge", async retrieve(input, access) {
      const documents: KnowledgeIndexEvidence["documents"][number][] = [];
      const hits: KnowledgeHit[] = [];
      for (const target of input.targets) {
        const body = await access.read({ id: target.id, knowledgeId: target.knowledgeId }, { maxBytes: 32768 });
        documents.push({ id: target.id, knowledgeId: target.knowledgeId,
          sourceContentId: body.contentId, indexedContentId: body.contentId });
        if (mode.knowledge !== "zero" && hits.length < input.limit) hits.push({
          id: target.id, knowledgeId: target.knowledgeId, contentId: body.contentId, source: body.source,
          startOffset: 0, endOffset: body.bytes.length, snippet: new TextDecoder("utf-8", { fatal: true }).decode(body.bytes),
        });
      }
      if (mode.knowledge === "mixed" && hits[0]) hits[0] = { ...hits[0], source: "wrong-source" };
      return { hits, evidence: { staticRevisionByProvider: input.staticRevisionByProvider,
        mappingRevision: mode.knowledge === "stale" ? "m:old" : input.mappingRevision, observedAt, freshness: "current",
        sourceConfigRevision: "controlled-1", indexedConfigRevision: "controlled-1", documents,
      } };
    } },
  });
  indexedRevision = (await graph.getProvider(providerId)).staticRevision;
  return { graph, mode };
}
