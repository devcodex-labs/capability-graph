import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }]
  });
  const details = await graph.getCapabilities({ ids: ['acme::route'] });
  const upstream = details.items[0].capability.documents.find(doc => doc.id === 'upstream');
  const local = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
  let urlReadError;
  try {
    await graph.readDocument({ capabilityId: 'acme::route', documentId: 'upstream' });
    throw new Error('Expected URL reference to reject a body read');
  } catch (error) {
    if (!(error instanceof GraphError) || error.code !== 'CG_DOCUMENT_REFERENCE_ONLY') throw error;
    urlReadError = { code: error.code, phase: error.phase };
  }
  console.log(JSON.stringify({ local, upstream, urlReadError }, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
