import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';

const providerRoot = dirname(fileURLToPath(import.meta.url));
const graph = await CapabilityGraph.open({
  hostAllowedProviders: ['acme.http'],
  integrationEnabledProviders: ['acme.http'],
  providers: [{
    providerId: 'acme.http',
    authority: { kind: 'file', rootDir: providerRoot }
  }]
});

try {
  const provider = graph.forProvider('acme.http');
  const catalog = await provider.listCatalog({ limit: 20 });
  const requiredStaticRevision = catalog.meta.staticRevision;
  const detail = await provider.getCapabilities(['route.http'], { requiredStaticRevision });
  const neighbors = await provider.getNeighbors('route.http', { requiredStaticRevision });
  const documents = await provider.readDocuments({
    selected: ['route.http'],
    knowledgeIds: ['routing-guide'],
    requiredStaticRevision
  });

  if (!detail.results[0]?.ok || !documents.results[0]?.ok) {
    throw new Error(JSON.stringify({ detail, documents }));
  }
  console.log(JSON.stringify({
    catalog: catalog.items.map(({ id }) => id.capabilityId),
    detail: detail.results[0].value.id.capabilityId,
    parents: neighbors.groups.parents.items.map(({ id }) => id.capabilityId),
    document: documents.results[0].value.knowledgeId,
    text: documents.results[0].value.text,
    completeness: catalog.meta.completeness
  }, null, 2));
} finally {
  await graph.close();
}
