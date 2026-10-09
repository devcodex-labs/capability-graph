import assert from "node:assert/strict";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CapabilityGraph, type OpenConfig } from "@devcodex/capability-graph";
import { seedProviderRoot } from "../seed-api/main.js";
import { HttpRuntimeAdapter } from "./adapter.js";
import { HttpKnowledgeReader } from "./knowledge-reader.js";
import { startHttpService } from "./service.js";
import { TextCapabilityRetriever, TextKnowledgeRetriever } from "./text-retrieval.js";

/** Real local sources and indexes, with host-owned lifecycle and disposable Provider copy. */
export async function createHttpRetrievalExample() {
  const repositoryRoot = path.resolve(seedProviderRoot, '../..');
  const { createTemporaryDirectory } = await import(pathToFileURL(path.join(repositoryRoot, 'scripts/lib/website-paths.mjs')).href);
  const root: string = await createTemporaryDirectory('http-retrieval-');
  let body = '请求校验：在 POST /users 的业务处理器之前验证输入。\n使用请求 Schema 描述必填字段。\n';
  let reads = 0;
  const source = createServer((_request, response) => {
    reads++;
    response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); response.end(body);
  });
  let graph: CapabilityGraph | undefined;
  let service: Awaited<ReturnType<typeof startHttpService>> | undefined;
  let reader: HttpKnowledgeReader | undefined;
  const close = async () => {
    try { await graph?.close(); } finally {
      try { await reader?.close(); } finally {
        try { await service?.close(); } finally {
          try {
            if (source.listening) await new Promise<void>((resolve, reject) => {
              source.close((error) => error ? reject(error) : resolve()); source.closeAllConnections();
            });
          } finally { await rm(root, { recursive: true, force: true }); }
        }
      }
    }
  };
  try {
    await cp(seedProviderRoot, root, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      source.once('error', reject); source.listen(0, '127.0.0.1', () => { source.removeListener('error', reject); resolve(); });
    });
    const address = source.address();
    if (!address || typeof address === 'string') throw new Error('Missing source address');
    const origin = `http://127.0.0.1:${address.port}`;
    const definitionFile = path.join(root, 'route-validation.capability.json');
    const definition = JSON.parse(await readFile(definitionFile, 'utf8'));
    definition.knowledge.push({ kind: 'document', knowledgeId: 'HTTP-GUIDE', role: 'guide', locale: 'zh',
      locator: { type: 'http', url: `${origin}/guide` } });
    await writeFile(definitionFile, JSON.stringify(definition));
    const config: OpenConfig = { hostAllowedProviders: ['seed.http'], integrationEnabledProviders: ['seed.http'],
      providers: [{ providerId: 'seed.http', authority: { kind: 'file', rootDir: root } }] };
    const snapshot = await CapabilityGraph.open(config);
    let staticRevision: string;
    try { staticRevision = (await snapshot.getProvider('seed.http')).staticRevision; } finally { await snapshot.close(); }
    service = await startHttpService({ project: 'http-example', environment: 'local', buildId: 'example-1', staticRevision });
    reader = new HttpKnowledgeReader({ allowedOrigins: [origin] });
    const capabilities = new TextCapabilityRetriever();
    const knowledge = new TextKnowledgeRetriever();
    graph = await CapabilityGraph.open({ ...config, readers: [reader], capabilityRetriever: capabilities, knowledgeRetriever: knowledge,
      runtimeAdapters: [new HttpRuntimeAdapter({ endpoint: `${service.url}/__capabilities/runtime` })] });
    await capabilities.rebuild(graph);
    return { graph, reader, capabilities, knowledge, root, staticRevision, sourcePort: address.port,
      serviceUrl: service.url, servicePort: service.port, body: () => body, reads: () => reads,
      updateBody: (next: string) => { body = next; }, close };
  } catch (error) { await close(); throw error; }
}

export async function runHttpRetrievalDemo() {
  const example = await createHttpRetrievalExample();
  try {
    const provider = example.graph.forProvider('seed.http');
    const recall = await provider.retrieveCapabilities({ text: 'validation', limit: 5 });
    assert(recall.items.some((item) => item.id.capabilityId === 'route.validation'));
    // Caller selects explicitly; recall does not implicitly select or expand knowledge.
    const selection = await provider.resolveSelection({ selected: ['route.validation'] });
    const read = await provider.readDocuments({ selected: ['route.validation'], knowledgeIds: ['HTTP-GUIDE'] });
    assert(read.results[0]?.ok);
    const query = { selected: [{ capabilityId: 'route.validation' }], knowledgeIds: ['HTTP-GUIDE'], text: '请求校验' };
    const found = await provider.queryKnowledge(query);
    assert(found.items.length > 0);
    const zero = await provider.queryKnowledge({ ...query, text: 'unfindablexyz' });
    assert.equal(zero.items.length, 0); assert.equal(zero.knowledgeState, 'searched');
    example.updateBody('请求校验更新：先检查必填字段，再执行业务处理器。\n');
    await assert.rejects(provider.queryKnowledge(query), { code: 'CG_INDEX_STALE' });
    await example.knowledge.invalidate({ providerId: 'seed.http', staticRevision: example.staticRevision, reason: 'knowledge_body' });
    const recovered = await provider.queryKnowledge(query);
    assert(recovered.items.length > 0);
    const runtime = await provider.queryRuntime({ project: 'http-example', environment: 'local' });
    assert(runtime.items.some((item) => item.instanceId === 'POST /users'));
    const response = await fetch(`${example.serviceUrl}/users`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 201);
    return { candidates: recall.items.map((item) => item.id.capabilityId),
      selected: selection.resolved.map((item) => item.capabilityId), document: 'HTTP-GUIDE',
      knowledgeHits: found.items.length, zeroHits: zero.items.length, staleRejected: true,
      recoveredHits: recovered.items.length, httpReads: example.reads(), businessStatus: response.status, modelCalls: 0 };
  } finally { await example.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runHttpRetrievalDemo(), null, 2));
}
