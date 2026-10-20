import { CapabilityGraph } from '@devcodex/capability-graph';
import { createGraphTools } from '@devcodex/capability-graph/tools';
import { fileURLToPath } from 'node:url';

const graph = await CapabilityGraph.open({
  providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
  allowedProviders: ['acme']
});
try {
  const tools = createGraphTools(graph);
  const call = async (name, args = {}) => {
    const outcome = await tools.call(name, args);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
    return outcome.data;
  };
  const providers = await call('capability_graph_list_providers');
  const catalog = await call('capability_graph_list_catalog');
  const details = await call('capability_graph_get_capabilities', { ids: ['acme::route'] });
  const resolved = await call('capability_graph_resolve', { ids: ['acme::route'] });
  const document = await call('capability_graph_read_document', {
    capabilityId: 'acme::route', documentId: 'guide'
  });
  // Default output is an explicit summary; --full preserves every raw result.
  const output = process.argv.includes('--full') ? { providers, catalog, details, resolved, document } : {
    providerIds: providers.items.map(item => item.providerId),
    catalogIds: catalog.items.map(item => item.id),
    selected: resolved.selected,
    nodeIds: resolved.nodes.map(node => node.capability.id),
    completeness: resolved.meta.completeness,
    documentText: document.text
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  await graph.close();
}
