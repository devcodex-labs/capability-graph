import { CapabilityGraph } from '../graph.js';
import { GraphError, fail } from '../errors.js';
import { copyJSON, freezeJSON } from '../json.js';
import { hasExecutor } from '../runtime.js';
import { outputChecks, standalone, toolShapes } from './schemas.js';
import type { ToolKey } from './schemas.js';
import type { GraphErrorShape, MatchOptions } from '../types.js';

export interface GraphToolsOptions { enableMatch?: boolean }
export interface GraphToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }
export type ToolCallOutcome<T = unknown> = { ok: true; data: T } | { ok: false; error: GraphErrorShape };
export interface GraphTools { readonly definitions: readonly GraphToolDefinition[]; call(name: string, arguments_?: unknown, options?: MatchOptions): Promise<ToolCallOutcome> }
const descriptions: Record<ToolKey, string> = {
  list_providers: 'List permitted capability Providers and their versions.',
  list_catalog: 'Read the complete compact catalog for permitted Providers. Choose existing IDs before resolving.',
  get_capabilities: 'Read complete definitions and deterministic applicability for explicit capability IDs.',
  resolve: 'Resolve selected capabilities and explicitly requested relationships, including required dependencies.',
  read_document: 'Read a declared, permitted local document. HTTPS references are not fetched.',
  match: 'Use the explicitly configured model once to select permitted roots, then resolve their details and dependencies.',
};
export function createGraphTools(graph: CapabilityGraph, options: GraphToolsOptions = {}): GraphTools {
  if (options.enableMatch !== undefined && typeof options.enableMatch !== 'boolean') fail('CG_CONFIG_INVALID', 'config', 'enableMatch must be boolean', 'check_config');
  if (options.enableMatch && !hasExecutor(graph)) fail('CG_MODEL_NOT_CONFIGURED', 'config', 'Match tool requires a configured ModelExecutor', 'check_config');
  const keys = (Object.keys(toolShapes) as ToolKey[]).filter(key => key !== 'match' || options.enableMatch);
  const definitions = freezeJSON(keys.map(key => ({ name: 'capability_graph_' + key, description: descriptions[key], inputSchema: standalone(toolShapes[key].input), outputSchema: standalone(toolShapes[key].output) })));
  return {
    definitions,
    async call(name, arguments_ = {}, callOptions) {
      try {
        const key = keys.find(key => 'capability_graph_' + key === name);
        if (!key) fail('CG_INPUT_INVALID', 'query', 'Unknown or disabled Graph tool', 'fix_input');
        let data: unknown;
        // SDK methods own input validation, including precise Context and lifecycle errors.
        if (key === 'list_providers') data = await graph.listProviders(arguments_ as Parameters<CapabilityGraph['listProviders']>[0]);
        else if (key === 'list_catalog') data = await graph.listCatalog(arguments_ as Parameters<CapabilityGraph['listCatalog']>[0]);
        else if (key === 'get_capabilities') data = await graph.getCapabilities(arguments_ as Parameters<CapabilityGraph['getCapabilities']>[0]);
        else if (key === 'resolve') data = await graph.resolve(arguments_ as Parameters<CapabilityGraph['resolve']>[0]);
        else if (key === 'read_document') data = await graph.readDocument(arguments_ as Parameters<CapabilityGraph['readDocument']>[0]);
        else data = await graph.match(arguments_ as Parameters<CapabilityGraph['match']>[0], callOptions);
        if (!outputChecks.get(key)!(data)) fail('CG_CONFIG_INVALID', 'config', 'Graph result does not match its declared success schema', 'contact_admin');
        return { ok: true, data: copyJSON(data) };
      } catch (error) {
        return { ok: false, error: error instanceof GraphError ? error.toJSON() : { code: 'CG_CONFIG_INVALID', phase: 'config', message: 'Graph tool could not complete safely', nextAction: 'contact_admin' } };
      }
    },
  };
}
