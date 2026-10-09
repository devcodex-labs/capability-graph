import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'main-entry-client', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  stderr: 'inherit'
});
async function query(name, args) {
  const reply = await client.callTool({ name, arguments: args });
  const block = reply.content.find((item) => item.type === 'text');
  if (!block) throw new Error('MCP result has no JSON text');
  const value = JSON.parse(block.text);
  if (reply.isError) throw new Error(JSON.stringify(value));
  if (value.results?.some((item) => !item.ok) ||
      value.capabilities?.some((item) => !item.ok)) throw new Error(JSON.stringify(value));
  if (value.meta?.completeness !== 'complete' || value.meta.warnings.length ||
      value.nextCursor || Object.values(value.groups ?? {}).some((group) =>
        group.completeness !== 'complete' || group.nextCursor)) {
    throw new Error('Inspect meta and continue paging before treating the result as complete.');
  }
  return value;
}
try {
  await client.connect(transport);
  const main = await query('example_list_main_capabilities', {});
  const R = main.staticRevision;
  const children = await query('example_get_neighbors', {
    qualifiedId: 'seed.http::route', kinds: ['children'], requiredStaticRevision: R
  });
  const selected = [{ providerId: 'seed.http', capabilityId: 'route.validation' }];
  const detail = await query('example_get_capabilities', { ids: selected, requiredStaticRevision: R });
  const selection = await query('example_resolve_selection', {
    selected, requiredStaticRevisionByProvider: { 'seed.http': R }
  });
  const documents = await query('example_read_documents', {
    selected: selection.resolved, requestProviderScope: ['seed.http'],
    requiredStaticRevision: R, knowledgeIds: ['D-02', 'D-03'],
    roles: ['guide', 'reference'], locales: ['en']
  });
  console.log(JSON.stringify({
    main: main.capabilities.map(({ id }) => id.capabilityId),
    children: children.groups.children.items.map(({ id }) => id.capabilityId),
    detail: detail.results[0].value.id.capabilityId,
    resolved: selection.resolved.map(({ capabilityId }) => capabilityId),
    added: selection.added.map(({ capabilityId }) => capabilityId),
    documents: documents.results.map(({ value }) => value.knowledgeId)
  }, null, 2));
} finally {
  try { await client.close(); } finally { await transport.close(); }
}
