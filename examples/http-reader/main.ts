import assert from "node:assert/strict";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CapabilityGraph } from "@devcodex/capability-graph";
import { seedProviderRoot } from "../seed-api/main.js";
import { HttpKnowledgeReader } from "./knowledge-reader.js";

/** A real HTTP source; the host selects capabilities and reads the exact associated document. */
export async function runHttpReaderDemo() {
  const repository = path.resolve(seedProviderRoot, "../..");
  const { createTemporaryDirectory } = await import(pathToFileURL(path.join(repository, "scripts/lib/artifact-paths.mjs")).href);
  const root: string = await createTemporaryDirectory("http-reader-");
  const text = "\ufeff# 请求校验\r\n" + "中文🙂 文档正文\r\n".repeat(4000);
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" }).end(text));
  let graph: CapabilityGraph | undefined; let reader: HttpKnowledgeReader | undefined;
  try {
    await cp(seedProviderRoot, root, { recursive: true });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const file = path.join(root, "capabilities/route-validation.json"); const definition = JSON.parse(await readFile(file, "utf8"));
    definition.knowledge.push({ kind: "document", knowledgeId: "HTTP-GUIDE", role: "guide", locale: "zh",
      locator: { type: "http", url: `${origin}/guide` } });
    await writeFile(file, JSON.stringify(definition));
    reader = new HttpKnowledgeReader({ allowedOrigins: [origin] });
    graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
      providers: [{ providerId: "seed.http", authority: { kind: "file", definitionLayout: "directory", rootDir: root } }], readers: [reader] });
    const provider = graph.forProvider("seed.http");
    const selection = await provider.resolveSelection({ selected: ["route.validation"] });
    let cursor: string | undefined; let restored = ""; let pages = 0;
    do {
      const page = await provider.readDocumentPage({ capabilityId: "route.validation", knowledgeId: "HTTP-GUIDE", ...(cursor ? { cursor } : {}) });
      restored += page.text; cursor = page.nextCursor; pages++;
    } while (cursor);
    assert.deepEqual(Buffer.from(restored), Buffer.from(text)); assert.equal(reader.activeRequests, 0);
    return { selected: selection.resolved.map((id) => id.capabilityId), document: "HTTP-GUIDE", pages, byteLength: Buffer.byteLength(text), originalBytesVerified: true };
  } finally {
    try { await graph?.close(); } finally {
      try { await reader?.close(); } finally {
        try { if (server.listening) await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }); }
        finally { await rm(root, { recursive: true, force: true }); }
      }
    }
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) console.log(JSON.stringify(await runHttpReaderDemo(), null, 2));
