import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CapabilityGraph, CapabilityGraphError, parseQualifiedId } from '@devcodex/capability-graph';

const id = z.object({ providerId: z.string(), capabilityId: z.string() });
const revision = { requiredStaticRevision: z.string().optional() };
const kinds = ['parents', 'children', 'specializes', 'specializedBy',
  'related', 'relatedBy', 'requires', 'requiredBy'];
const response = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

/** This reference owns one graph; the host owns authentication and project binding. */
export async function createMainEntryServer({ mainEntries = ['route'] } = {}) {
  const rootDir = fileURLToPath(new URL('../../seed-provider/', import.meta.url));
  const graph = await CapabilityGraph.open({
    hostAllowedProviders: ['seed.http'], integrationEnabledProviders: ['seed.http'],
    providers: [{ providerId: 'seed.http', authority: { kind: 'file', definitionLayout: 'directory', rootDir } }]
  });
  const server = new McpServer({ name: 'seed-main-entry', version: '0.1.0' });
  const call = async (operation) => {
    try { return response(await operation()); }
    catch (error) {
      return { ...response(error instanceof CapabilityGraphError
        ? { code: error.code, nextAction: error.nextAction }
        : { code: 'CG_PARTIAL_ITEM', nextAction: 'repair_source' }), isError: true };
    }
  };
  server.registerTool('example_list_main_capabilities', {
    description: 'List explicit main entries, not every capability.', inputSchema: revision
  }, (query) => call(async () => {
    const details = await graph.forProvider('seed.http').getCapabilities(mainEntries, query);
    return {
      capabilities: details.results.map((item) => item.ok
        ? { ok: true, id: item.value.id, name: item.value.name,
          description: item.value.description, whenToUse: item.value.whenToUse,
          distinction: item.value.distinction }
        : item),
      staticRevision: details.meta.staticRevision, meta: details.meta
    };
  }));
  server.registerTool('example_get_neighbors', {
    description: 'Expand only requested relation groups.',
    inputSchema: { ...revision, qualifiedId: z.string(),
      kinds: z.array(z.enum(kinds)).optional(),
      limitPerKind: z.number().int().positive().optional(),
      cursors: z.object(Object.fromEntries(kinds.map((kind) => [kind, z.string().optional()]))).optional() }
  }, ({ qualifiedId, ...query }) => call(() => graph.getNeighbors(parseQualifiedId(qualifiedId), query)));
  server.registerTool('example_get_capabilities', {
    description: 'Get bounded details for explicit identities.',
    inputSchema: { ...revision, ids: z.array(id) }
  }, ({ ids, ...query }) => call(() => graph.getCapabilities(ids, query)));
  server.registerTool('example_resolve_selection', {
    description: 'Complete required context, not an execution plan.',
    inputSchema: { selected: z.array(id), requestProviderScope: z.array(z.string()).optional(),
      requiredStaticRevisionByProvider: z.record(z.string()).optional() }
  }, (query) => call(() => graph.resolveSelection(query)));
  server.registerTool('example_read_documents', {
    description: 'Read knowledge declared by the full selected context.',
    inputSchema: { ...revision, selected: z.array(id), requestProviderScope: z.array(z.string()).optional(),
      knowledgeIds: z.array(z.string()).optional(), roles: z.array(z.string()).optional(),
      locales: z.array(z.string()).optional() }
  }, (query) => call(() => graph.readDocuments(query)));
  return { server, graph };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, graph } = await createMainEntryServer();
  let closing;
  const close = () => closing ??= (async () => {
    try { await server.close(); } finally { await graph.close(); }
  })();
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  process.stdin.once('end', () => { void close(); });
  try { await server.connect(new StdioServerTransport()); }
  catch (error) {
    console.error(error);
    await close();
    process.exitCode = 1;
  }
}
