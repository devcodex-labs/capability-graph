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
  const selection = await provider.resolveSelection({ selected: ['route.http'], requiredStaticRevision });
  const documents = await provider.readDocuments({
    selected: selection.resolved.map(({ capabilityId }) => capabilityId),
    knowledgeIds: ['routing-guide'],
    roles: ['guide'],
    locales: ['en'],
    requiredStaticRevision
  });
  const specification = await provider.readSpecification({ knowledgeIds: ['SPEC-01'], requiredStaticRevision });

  if (!detail.results[0]?.ok || !documents.results[0]?.ok || !specification.results[0]?.ok) {
    throw new Error(JSON.stringify({ detail, documents, specification }));
  }
  console.log(JSON.stringify({
    catalog: catalog.items.map(({ id }) => id.capabilityId),
    detail: detail.results[0].value.id.capabilityId,
    parents: neighbors.groups.parents.items.map(({ id }) => id.capabilityId),
    selected: selection.resolved.map(({ capabilityId }) => capabilityId),
    document: documents.results[0].value.knowledgeId,
    specification: specification.results[0].value.knowledgeId,
    text: documents.results[0].value.text,
    completeness: catalog.meta.completeness
  }, null, 2));
} finally {
  await graph.close();
}
