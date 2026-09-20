import { CoreHost, type StaticOpenConfig } from "./core-host.js";
import { CapabilityGraphError } from "./errors.js";
import { documents, validateSelection, type ReadDocumentsQuery } from "./knowledge/read.js";
import type { KnowledgeReader, KnowledgeRetriever, CapabilityRetriever } from "./knowledge/types.js";
import { retrieveCapabilities } from "./retrieval/capabilities.js";
import { queryKnowledge } from "./retrieval/knowledge.js";
import type { QueryKnowledgeQuery, RetrieveCapabilitiesQuery } from "./retrieval/types.js";
import type { RuntimeAdapter, QueryRuntimeQuery } from "./runtime/types.js";
import { queryRuntime, validateRuntimeQuery } from "./runtime/query.js";
import { inputInvalid, identity } from "./query/common.js";
import { isId } from "./identity.js";
import { catalog, details, neighbors, provider, refScope } from "./query/static.js";
import type { CapabilityDetailQuery, CapabilityRef, CatalogQuery, NeighborQuery, ProviderListQuery, ProviderResult } from "./query/types.js";

/** One authority per provider; optional adapters do not change the offline static-query contract. */
export interface OpenConfig extends StaticOpenConfig {
  readonly runtimeAdapters?: readonly RuntimeAdapter[];
  readonly readers?: readonly KnowledgeReader[];
  readonly knowledgeRetriever?: KnowledgeRetriever;
  readonly capabilityRetriever?: CapabilityRetriever;
}
interface Extensions {
  readonly runtimeAdapters: ReadonlyMap<string, RuntimeAdapter>;
  readonly readers: readonly KnowledgeReader[];
  readonly knowledgeRetriever?: KnowledgeRetriever;
  readonly capabilityRetriever?: CapabilityRetriever;
}
function extensions(config: OpenConfig): Extensions {
  const invalid = () => { throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" }); };
  if (!config || typeof config !== "object" || (config.readers !== undefined && !Array.isArray(config.readers))) invalid();
  for (const reader of config.readers ?? []) if (!reader || typeof reader.id !== "string" || !reader.id || typeof reader.canRead !== "function" || typeof reader.read !== "function") invalid();
  for (const retriever of [config.knowledgeRetriever, config.capabilityRetriever]) if (retriever !== undefined &&
    (!retriever || typeof retriever.id !== "string" || !retriever.id || typeof retriever.retrieve !== "function")) invalid();
  if (config.runtimeAdapters !== undefined && !Array.isArray(config.runtimeAdapters)) invalid();
  const runtimeAdapters = new Map<string, RuntimeAdapter>();
  for (const adapter of config.runtimeAdapters ?? []) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id || !isId(adapter.providerId) || typeof adapter.query !== "function" || runtimeAdapters.has(adapter.providerId)) invalid();
    runtimeAdapters.set(adapter.providerId, adapter);
  }
  return Object.freeze({ runtimeAdapters, readers: Object.freeze([...(config.readers ?? [])]), knowledgeRetriever: config.knowledgeRetriever, capabilityRetriever: config.capabilityRetriever });
}

function queryObject<T extends object>(query: T): T {
  if (!query || typeof query !== "object") inputInvalid();
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(query))) inputInvalid();
    for (const key of Reflect.ownKeys(query)) {
      if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(query, key)!, "value")) inputInvalid();
    }
  } catch (error) {
    if (error instanceof CapabilityGraphError) throw error;
    inputInvalid();
  }
  return query;
}

/**
 * Protocol-independent discovery and knowledge access. Does not execute capabilities or start MCP servers.
 * Queries pin their source views; close the owning graph after all consumers have finished.
 */
export class CapabilityGraph {
  private constructor(private readonly host: CoreHost, private readonly extensions: Extensions) {}
  /** Validate every configured authority before exposing a graph; a failed initial load rejects the open. */
  static async open(config: OpenConfig): Promise<CapabilityGraph> {
    const configured = extensions(config);
    return new CapabilityGraph(await CoreHost.open(config), configured);
  }
  /** Serialize refreshes and publish each provider independently; inspect per-provider failures in the result. */
  reload(options: { providerId?: string } = {}) { return this.host.reload(queryObject(options)); }
  /**
   * Reject new work and release owned views after queued refreshes. Existing query pins may outlive this call.
   * A later close can report delayed cleanup failures; adapter-owned work is not cancelled.
   */
  close() { return this.host.close(); }
  /** Bind identity/scope, not a static revision. The facade shares this graph's lifecycle and reloads. */
  forProvider(providerId: string): BoundProviderGraph { this.host.assertAllowed(providerId); return new BoundProviderGraph(this.host, providerId, this.extensions); }
  /** List loaded providers in the narrowed scope; any listed unreadable source fails the query. */
  listProviders(query: ProviderListQuery = {}) {
    queryObject(query);
    return this.host.query(query.requestProviderScope, query.requiredStaticRevision, async (ctx) => ({
      items: await Promise.all([...ctx.scope].sort().filter((id) => ctx.graph.getProvider(id)).map((id) => provider(ctx, id))), meta: ctx.meta }));
  }
  /** Read provider metadata plus revision/refresh provenance, never Specification body or version applicability decisions. */
  getProvider(providerId: string, query: { requiredStaticRevision?: string } = {}): Promise<ProviderResult> {
    queryObject(query);
    this.host.assertAllowed(providerId);
    return this.host.query([providerId], query.requiredStaticRevision, async (ctx) => ({ ...await provider(ctx, providerId), meta: ctx.meta }));
  }
  /** Return a bounded flat discovery page; use nextCursor without changing scope, filters or revision. */
  listCatalog(query: CatalogQuery = {}) {
    queryObject(query);
    return this.host.query(query.requestProviderScope, query.requiredStaticRevision, (ctx) => catalog(ctx, query, this.host.budgets));
  }
  /** Preserve input order and failures per slot; an unreadable explicitly requested revision fails the whole query. */
  getCapabilities(ids: readonly CapabilityRef[], query: CapabilityDetailQuery = {}) {
    queryObject(query);
    const scope = query.requiredStaticRevision === undefined ? undefined : refScope(ids);
    return this.host.query(scope, query.requiredStaticRevision, (ctx) => details(ctx, ids, query, this.host.budgets));
  }
  /** Page direct/reverse edges by kind, within one provider. Related edges are not made symmetric. */
  getNeighbors(ref: CapabilityRef, query: NeighborQuery = {}) {
    queryObject(query);
    const id = identity(ref);
    return this.host.query([id.providerId], query.requiredStaticRevision, (ctx) => neighbors(ctx, id, query, this.host.budgets));
  }
  /** Read associated Documents from a nonempty selection; Collections require explicit queryKnowledge instead. */
  readDocuments(query: ReadDocumentsQuery) {
    queryObject(query);
    validateSelection(query);
    return this.host.query(query.requestProviderScope ?? (query.requiredStaticRevision === undefined ? undefined : refScope(query.selected)), query.requiredStaticRevision,
      (ctx) => documents(ctx, query, this.host.budgets, this.extensions.readers, this.extensions.knowledgeRetriever));
  }
  /** Optional candidate recall, verified against authority with original ranks; never silently substitutes for catalog. */
  retrieveCapabilities(query: RetrieveCapabilitiesQuery) {
    queryObject(query);
    return this.host.query(query.requestProviderScope, query.requiredStaticRevision,
      (ctx) => retrieveCapabilities(ctx, query, this.host.budgets, this.extensions.capabilityRetriever));
  }
  /** Search only selected knowledge and return traceable evidence snippets, not a generated answer. */
  queryKnowledge(query: QueryKnowledgeQuery) {
    queryObject(query);
    validateSelection(query);
    return this.host.query(query.requestProviderScope ?? (query.requiredStaticRevision === undefined ? undefined : refScope(query.selected)), query.requiredStaticRevision,
      (ctx) => queryKnowledge(ctx, query, this.host.budgets, this.extensions.readers, this.extensions.knowledgeRetriever));
  }
  /** Explicitly query one provider/project/environment; disabled, unavailable and observed-empty are distinct states. */
  queryRuntime(query: QueryRuntimeQuery) {
    queryObject(query);
    validateRuntimeQuery(query);
    const scope = query.requestProviderScope ?? (query.instanceOf === undefined ? undefined : [identity(query.instanceOf).providerId]);
    return this.host.query(scope, query.requiredStaticRevision, (ctx) => queryRuntime(ctx, query, this.host.budgets, this.extensions.runtimeAdapters));
  }
}

/** Reject even JavaScript attempts to replace a bound provider's scope. */
export function boundQuery<T extends object>(query: T): T {
  queryObject(query);
  if ("requestProviderScope" in query) inputInvalid();
  return query;
}

/**
 * Provider-scoped facade obtained from CapabilityGraph.forProvider; it never owns source handles.
 * All query semantics match CapabilityGraph, except requestProviderScope overrides are rejected.
 */
export class BoundProviderGraph {
  constructor(private readonly host: CoreHost, readonly providerId: string, private readonly extensions: Extensions) {}
  /** Read this provider's metadata and provenance, optionally from its retained previous revision. */
  getProvider(query: { requiredStaticRevision?: string } = {}): Promise<ProviderResult> {
    boundQuery(query);
    return this.host.query([this.providerId], query.requiredStaticRevision, async (ctx) => ({ ...await provider(ctx, this.providerId), meta: ctx.meta }));
  }
  /** Page the bound provider's catalog; parent references may omit providerId. */
  listCatalog(query: Omit<CatalogQuery, "requestProviderScope"> = {}) {
    boundQuery(query);
    return this.host.query([this.providerId], query.requiredStaticRevision, (ctx) => catalog(ctx, query, this.host.budgets, this.providerId));
  }
  /** Resolve provider-local string IDs, retaining the original input slots. */
  getCapabilities(ids: readonly string[], query: CapabilityDetailQuery = {}) {
    boundQuery(query); if (!Array.isArray(ids)) inputInvalid();
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => details(ctx, ids.map((capabilityId) => ({ capabilityId })), query, this.host.budgets, this.providerId));
  }
  /** Page each requested relation kind for a provider-local string ID. */
  getNeighbors(capabilityId: string, query: NeighborQuery = {}) {
    boundQuery(query);
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => neighbors(ctx, { capabilityId }, query, this.host.budgets, this.providerId));
  }
  /** Read associated Documents; selected contains provider-local string IDs, not canonical objects. */
  readDocuments(query: Omit<ReadDocumentsQuery, "requestProviderScope" | "selected"> & { readonly selected: readonly string[] }) {
    boundQuery(query); if (!Array.isArray(query.selected)) inputInvalid();
    const normalized = { ...query, selected: query.selected.map((capabilityId) => ({ capabilityId })) };
    validateSelection(normalized);
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => documents(ctx, normalized, this.host.budgets, this.extensions.readers, this.extensions.knowledgeRetriever, this.providerId));
  }
  /** Recall candidates only within this provider; candidate failures remain warnings. */
  retrieveCapabilities(query: Omit<RetrieveCapabilitiesQuery, "requestProviderScope">) {
    boundQuery(query);
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => retrieveCapabilities(ctx, query, this.host.budgets, this.extensions.capabilityRetriever));
  }
  /** Search selected CapabilityRef objects; omitted providerId is filled from this binding. */
  queryKnowledge(query: Omit<QueryKnowledgeQuery, "requestProviderScope">) {
    boundQuery(query); validateSelection(query);
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => queryKnowledge(ctx, query, this.host.budgets, this.extensions.readers, this.extensions.knowledgeRetriever, this.providerId));
  }
  /** Query this provider's runtime source; project and environment remain mandatory. */
  queryRuntime(query: Omit<QueryRuntimeQuery, "requestProviderScope">) {
    boundQuery(query); validateRuntimeQuery(query);
    return this.host.query([this.providerId], query.requiredStaticRevision,
      (ctx) => queryRuntime(ctx, query, this.host.budgets, this.extensions.runtimeAdapters, this.providerId));
  }
}
