import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./details.provider.json', import.meta.url)) }]
  });
  const catalog = await graph.listCatalog();
  const details = await graph.getCapabilities({ ids: ['acme::route'] });
  const document = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
  console.log(JSON.stringify({ catalog, details, document }, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
