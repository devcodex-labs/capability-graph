import { Ajv, type ValidateFunction } from "ajv";
import type { CapabilityGraph } from "../capability-graph.js";
import { CapabilityGraphError } from "../errors.js";
import { isId } from "../identity.js";
import type { CanonicalCapabilityId } from "../types.js";
import type { CatalogQuery, CapabilityDetailQuery, KnowledgeMembersQuery, NeighborQuery, ResolveSelectionQuery } from "../query/types.js";
import type { ReadDocumentsQuery, ReadSpecificationQuery } from "../knowledge/read.js";
import type { DocumentBodyQuery, SpecificationBodyQuery } from "../knowledge/pages.js";
import { toolDefinitions } from "./tool-definitions.js";
import type { CapabilityGraphToolkit, ToolkitOptions, ToolCallResult, ToolCallContext } from "./types.js";

class ToolError extends Error {
  constructor(readonly code: string, message: string, readonly nextAction: string) { super(message); }
}
const invalid = (): never => { throw new ToolError("CG_TOOL_INPUT_INVALID", "Tool arguments must match the JSON input schema.", "fix_input"); };

// Inspect descriptors before copying: JSON serialization would execute a getter/toJSON and mutate host state.
function copyJson(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) return invalid();
  if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in descriptors[key]!))) return invalid();
    if (Array.isArray(value)) {
      if (Object.keys(descriptors).some(key => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)) || Object.keys(descriptors).length !== value.length + 1) return invalid();
      return Array.from({ length: value.length }, (_, i) => copyJson(descriptors[String(i)]!.value, seen));
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) return invalid();
      result[key] = copyJson(descriptor.value, seen);
    }
    return result;
  } finally { seen.delete(value); }
}
function result(value: Record<string, unknown>, isError: boolean): ToolCallResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError };
}

/** Borrow an existing graph. No lifecycle ownership, network listeners, dynamic per-Provider tools, or model loop. */
export function createCapabilityGraphToolkit(graph: CapabilityGraph, options: ToolkitOptions = {}): CapabilityGraphToolkit {
  const prefix = options.namePrefix ?? "capability_graph_";
  if (typeof prefix !== "string" || !/^[A-Za-z0-9_-]+$/.test(prefix)) throw new ToolError("CG_TOOL_INPUT_INVALID", "Invalid tool name prefix.", "fix_input");
  const definitions = toolDefinitions(prefix);
  if (definitions.some(tool => tool.name.length > 128)) throw new ToolError("CG_TOOL_INPUT_INVALID", "Tool names exceed 128 characters.", "fix_input");
  const graphScope = graph.getProviderScope();
  const requested = options.allowedProviders ?? graphScope;
  if (!Array.isArray(requested) || requested.some(id => !isId(id) || !graphScope.includes(id)))
    throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  const allowed = Object.freeze([...new Set(requested)].sort());
  const maximum = options.maxToolResultBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1) invalid();
  const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  const validators = new Map<string, ValidateFunction>(definitions.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  const denied = (): never => { throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" }); };
  return Object.freeze({
    listTools: () => definitions,
    async callTool(name: string, arguments_: unknown, context: ToolCallContext = {}) {
      try {
        if (context.signal !== undefined && !(context.signal instanceof AbortSignal)) invalid();
        context.signal?.throwIfAborted();
        const validate = validators.get(name);
        if (!validate) throw new ToolError("CG_TOOL_UNKNOWN", "Unknown Capability Graph tool.", "fix_input");
        const input = copyJson(arguments_) as Record<string, unknown>;
        if (!validate(input)) invalid();
        const requestedScope = input.requestProviderScope as string[] | undefined;
        if (requestedScope?.some(id => !allowed.includes(id))) denied();
        const effective = requestedScope ?? allowed;
        const { requestProviderScope: _scope, ...query } = input;
        const scoped: Record<string, unknown> = { ...query, requestProviderScope: effective };
        const body = { ...query, ...(context.signal ? { signal: context.signal } : {}) };
        const suffix = name.slice(prefix.length);
        if (typeof query.providerId === "string" && !effective.includes(query.providerId)) denied();
        if (query.capability && !effective.includes((query.capability as CanonicalCapabilityId).providerId)) denied();
        let value: object;
        switch (suffix) {
          case "list_providers": value = await graph.listProviders(scoped); break;
          case "get_provider": value = await graph.getProvider(query.providerId as string, query); break;
          case "list_specification_documents": value = await graph.listSpecificationDocuments(query as unknown as Parameters<CapabilityGraph["listSpecificationDocuments"]>[0]); break;
          case "list_catalog": value = await graph.listCatalog(scoped as CatalogQuery); break;
          case "get_capabilities": {
            const { ids, ...detail } = scoped;
            value = await graph.getCapabilities(ids as CanonicalCapabilityId[], detail as CapabilityDetailQuery); break;
          }
          case "list_knowledge_members": value = await graph.listKnowledgeMembers(query as unknown as KnowledgeMembersQuery); break;
          case "get_neighbors": {
            const { capability, ...neighbor } = query;
            value = await graph.getNeighbors(capability as CanonicalCapabilityId, neighbor as NeighborQuery); break;
          }
          case "resolve_selection": value = await graph.resolveSelection(scoped as unknown as ResolveSelectionQuery); break;
          case "read_documents": value = await graph.readDocuments({ ...body, requestProviderScope: effective } as unknown as ReadDocumentsQuery); break;
          case "read_document_page": value = await graph.readDocumentPage(body as unknown as DocumentBodyQuery); break;
          case "read_specification": value = await graph.readSpecification(body as unknown as ReadSpecificationQuery); break;
          case "read_specification_page": value = await graph.readSpecificationPage(body as unknown as SpecificationBodyQuery); break;
          default: throw new ToolError("CG_TOOL_UNKNOWN", "Unknown Capability Graph tool.", "fix_input");
        }
        context.signal?.throwIfAborted();
        const output = result(value as Record<string, unknown>, false);
        if (Buffer.byteLength(JSON.stringify(output)) > maximum) throw new ToolError("CG_TOOL_RESULT_TOO_LARGE", "The complete tool result exceeds the byte budget.", "page_or_filter");
        return output;
      } catch (error) {
        const cancelled = context.signal?.aborted;
        const projected = cancelled ? new ToolError("CG_TOOL_CANCELLED", "The tool call was cancelled.", "retry") :
          error instanceof CapabilityGraphError || error instanceof ToolError ? error :
            new ToolError("CG_TOOL_INTERNAL", "The tool call failed internally.", "inspect_server_log");
        return result({ error: { code: projected.code, message: projected.message, nextAction: projected.nextAction,
          ...(projected instanceof CapabilityGraphError && projected.details ? { details: projected.details } : {}) } }, true);
      }
    },
  });
}
