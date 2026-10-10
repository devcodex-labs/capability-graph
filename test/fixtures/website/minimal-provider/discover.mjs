import { fileURLToPath } from 'node:url';
import { CapabilityGraph } from '@devcodex/capability-graph';

const graph = await CapabilityGraph.open({
  hostAllowedProviders: ['acme.http'],
  integrationEnabledProviders: ['acme.http'],
  providers: [{
    providerId: 'acme.http',
    authority: {
      kind: 'file', definitionLayout: 'directory',
      rootDir: fileURLToPath(new URL('./providers/acme-http/', import.meta.url))
    }
  }]
});

try {
  const provider = graph.forProvider('acme.http');
  const catalog = await provider.listCatalog({ limit: 20 });
  console.log(JSON.stringify({
    catalog: catalog.items.map(({ id }) => id.capabilityId),
    completeness: catalog.meta.completeness,
    hasNextCursor: Boolean(catalog.nextCursor)
  }, null, 2));
} finally {
  await graph.close();
}
