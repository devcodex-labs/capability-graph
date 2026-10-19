import { fail, GraphError } from './errors.js';
import { bytes, copyJSON, descriptors, freezeJSON } from './json.js';
import { context, applicability } from './applicability.js';
import { loadProvider, parseOpen } from './loader.js';
import type { SourceConfig } from './loader.js';
import { Snapshot } from './snapshot.js';
import { resolveSnapshot } from './resolver.js';
import { readDocument as readLocalDocument } from './documents.js';
import { modelFailure, validateSelection } from './model.js';
import { markExecutor, markExplicitScope } from './runtime.js';
import { ID, QID, relationKinds } from './schema.js';
import type { CapabilityDetailResult, CatalogEntry, CatalogResult, DocumentReadResult, ErrorPhase, GraphLimits, MatchContext, MatchOptions, MatchQuery, MatchResult, ModelExecutor, OpenOptions, ProviderListResult, RelationKind, ReloadResult, ResolveResult, ResultMeta } from './types.js';

function queryObject(value: unknown, fields: string[], phase: ErrorPhase = 'query'): Record<string, unknown> {
  if (value === undefined) return {};
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors(value, 'CG_INPUT_INVALID', phase))) {
    if (!fields.includes(key)) fail('CG_INPUT_INVALID', phase, 'Unknown query field', 'fix_input');
    if (descriptor.value !== undefined) Object.defineProperty(result, key, { value: key === 'context' ? context(descriptor.value) : copyJSON(descriptor.value, 'CG_INPUT_INVALID', phase), enumerable: true });
  }
  return result;
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !QID.test(id))) fail('CG_INPUT_INVALID', 'query', 'ids must be a nonempty list of complete capability IDs', 'fix_input');
  return [...new Set(value as string[])];
}
function catalog(capability: CatalogEntry): CatalogEntry {
  return { id: capability.id, providerId: capability.providerId, name: capability.name, description: capability.description,
    ...(capability.whenToUse === undefined ? {} : { whenToUse: capability.whenToUse }), ...(capability.appliesTo === undefined ? {} : { appliesTo: capability.appliesTo }) };
}

export class CapabilityGraph {
  #snapshot: Snapshot;
  readonly #sources: SourceConfig[];
  readonly #limits: GraphLimits;
  readonly #allowed: string[] | undefined;
  readonly #model: ModelExecutor | undefined;
  readonly #sourceIds: string[];
  #reloadTail: Promise<void> = Promise.resolve();
  readonly #active = new Set<(error: GraphError) => void>();
  #closed = false;
  private constructor(snapshot: Snapshot, parsed: ReturnType<typeof parseOpen>) {
    this.#snapshot = snapshot; this.#sources = parsed.sources; this.#limits = parsed.limits; this.#allowed = parsed.allowed; this.#model = parsed.model;
    this.#sourceIds = [...snapshot.providers.keys()];
    if (parsed.model) markExecutor(this);
    if (parsed.allowed !== undefined) markExplicitScope(this);
  }
  static async open(options: OpenOptions): Promise<CapabilityGraph> {
    const parsed = parseOpen(options);
    const providers = [];
    for (const source of parsed.sources) providers.push(await loadProvider(source, parsed.limits.maxProviderBytes));
    return new CapabilityGraph(new Snapshot(providers, parsed.allowed), parsed);
  }
  #current(): Snapshot { if (this.#closed) fail('CG_GRAPH_CLOSED', 'lifecycle', 'Graph is closed', 'check_config'); return this.#snapshot; }
  #scope(snapshot: Snapshot, requested: unknown, phase: ErrorPhase = 'query'): Set<string> {
    if (requested === undefined) return new Set([...snapshot.providers.keys()].filter(id => snapshot.allowed.has(id)));
    if (!Array.isArray(requested) || requested.some(id => typeof id !== 'string' || !ID.test(id))) fail('CG_INPUT_INVALID', phase, 'providers must be a list of Provider IDs', 'fix_input');
    const result = new Set(requested as string[]);
    for (const id of result) {
      if (this.#allowed === undefined && !snapshot.providers.has(id)) fail('CG_PROVIDER_NOT_FOUND', phase, 'Requested Provider is not loaded', 'check_config');
      if (!snapshot.allowed.has(id)) fail('CG_ACCESS_DENIED', phase, 'Provider scope is not allowed', 'contact_admin');
      if (!snapshot.providers.has(id)) fail('CG_PROVIDER_NOT_FOUND', phase, 'Requested Provider is not loaded', 'check_config');
    }
    return result;
  }
  #roots(snapshot: Snapshot, selected: string[], phase: ErrorPhase = 'query'): void {
    for (const id of selected) {
      const provider = id.split('::')[0]!;
      if (this.#allowed === undefined && !snapshot.providers.has(provider)) fail('CG_PROVIDER_NOT_FOUND', phase, 'Requested Provider is not loaded', 'check_config');
      // Decide denial without consulting hidden capability/Provider existence.
      if (!snapshot.allowed.has(provider)) fail('CG_ACCESS_DENIED', phase, 'Capability scope is not allowed', 'contact_admin');
      if (!snapshot.providers.has(provider)) fail('CG_PROVIDER_NOT_FOUND', phase, 'Requested Provider is not loaded', 'check_config');
      if (!snapshot.capabilities.has(id)) fail('CG_CAPABILITY_NOT_FOUND', phase, 'Requested capability does not exist', 'refresh');
    }
  }
  #context(value: unknown): MatchContext {
    const result = context(value);
    if (bytes(result) > this.#limits.maxContextBytes) fail('CG_INPUT_TOO_LARGE', 'query', 'Context exceeds maxContextBytes', 'fix_input');
    return result;
  }
  #result<T>(value: T, phase: ErrorPhase = 'query'): T {
    if (bytes(value) > this.#limits.maxResultBytes) fail('CG_RESULT_TOO_LARGE', phase, 'Result exceeds maxResultBytes', 'narrow_scope');
    return copyJSON(value);
  }
  #meta(snapshot: Snapshot): ResultMeta { return { revision: snapshot.revision, completeness: 'complete', warnings: [] }; }
  async listProviders(query?: { providers?: string[] }): Promise<ProviderListResult> {
    const snapshot = this.#current(); const q = queryObject(query, ['providers']); const scope = this.#scope(snapshot, q.providers);
    return this.#result({ items: [...scope].sort().map(id => snapshot.providers.get(id)!.summary), meta: this.#meta(snapshot) });
  }
  async listCatalog(query?: { providers?: string[] }): Promise<CatalogResult> {
    const snapshot = this.#current(); const q = queryObject(query, ['providers']); const scope = this.#scope(snapshot, q.providers);
    const result: CatalogResult = { items: [...snapshot.capabilities.values()].filter(c => scope.has(c.providerId)).map(catalog).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), meta: this.#meta(snapshot) };
    if (bytes(result) > this.#limits.maxCatalogBytes) fail('CG_CATALOG_TOO_LARGE', 'query', 'Full catalog exceeds maxCatalogBytes', 'narrow_scope');
    return this.#result(result);
  }
  async getCapabilities(query: { ids: string[]; context?: MatchContext }): Promise<CapabilityDetailResult> {
    const snapshot = this.#current(); const q = queryObject(query, ['ids', 'context']); const selected = ids(q.ids); this.#roots(snapshot, selected); const ctx = this.#context(q.context);
    return this.#result({ items: selected.map(id => { const capability = snapshot.capabilities.get(id)!; return { capability, applicability: applicability(capability.appliesTo, ctx) }; }), meta: this.#meta(snapshot) });
  }
  async resolve(query: { ids: string[]; context?: MatchContext; relations?: RelationKind[] }): Promise<ResolveResult> {
    const snapshot = this.#current(); const q = queryObject(query, ['ids', 'context', 'relations']); const selected = ids(q.ids); this.#roots(snapshot, selected); const ctx = this.#context(q.context);
    const requested = q.relations === undefined ? ['requires'] : q.relations;
    if (!Array.isArray(requested) || requested.some(kind => !relationKinds.includes(kind))) fail('CG_INPUT_INVALID', 'query', 'Unknown relation kind', 'fix_input');
    return this.#result(resolveSnapshot(snapshot, selected, ctx, [...new Set(requested as RelationKind[])]));
  }
  async readDocument(query: { capabilityId: string; documentId: string }): Promise<DocumentReadResult> {
    const snapshot = this.#current(); const q = queryObject(query, ['capabilityId', 'documentId'], 'document');
    if (typeof q.capabilityId !== 'string' || !QID.test(q.capabilityId) || typeof q.documentId !== 'string' || !q.documentId.trim()) fail('CG_INPUT_INVALID', 'document', 'A complete capability ID and explicit document ID are required', 'fix_input');
    this.#roots(snapshot, [q.capabilityId], 'document');
    return this.#result(await readLocalDocument(snapshot, q.capabilityId, q.documentId, this.#limits.maxDocumentBytes), 'document');
  }
  async reload(query?: { providerId?: string }): Promise<ReloadResult> {
    this.#current(); const q = queryObject(query, ['providerId'], 'lifecycle');
    if (q.providerId !== undefined && (typeof q.providerId !== 'string' || !ID.test(q.providerId))) fail('CG_INPUT_INVALID', 'lifecycle', 'providerId must be a Provider ID', 'fix_input');
    if (q.providerId !== undefined) this.#scope(this.#snapshot, [q.providerId], 'lifecycle');
    const execute = async (): Promise<ReloadResult> => {
      const previous = this.#current();
      const candidates = this.#sourceIds.map(id => previous.providers.get(id)!);
      const statuses = new Map<string, ReloadResult['providers'][number]>();
      let sourceFailed = false;
      for (let i = 0; i < this.#sources.length; i++) {
        const providerId = this.#sourceIds[i]!;
        if (q.providerId !== undefined && q.providerId !== providerId) continue;
        try {
          const candidate = await loadProvider(this.#sources[i]!, this.#limits.maxProviderBytes);
          if (candidate.summary.providerId !== providerId) fail('CG_DEFINITION_INVALID', 'load', 'Reload cannot change a configured Provider identity', 'fix_input');
          new Snapshot([candidate]); // Classify independently invalid sources before combined validation.
          candidates[i] = candidate;
          statuses.set(providerId, { providerId, status: candidate.staticHash === previous.providers.get(providerId)!.staticHash ? 'unchanged' : 'not_applied' });
        } catch (error) {
          sourceFailed = true;
          const e = error instanceof GraphError ? error : new GraphError('CG_RELOAD_FAILED', 'lifecycle', 'Provider refresh failed', 'retry');
          statuses.set(providerId, { providerId, status: 'failed', error: { code: e.code, message: e.message } });
        }
      }
      const visibleStatuses = () => [...statuses.values()].filter(item => previous.allowed.has(item.providerId));
      const failed = (code: string, message: string): ReloadResult => ({ ok: false, revision: previous.revision, providers: visibleStatuses(), error: { code, message } });
      if (this.#closed) return failed('CG_GRAPH_CLOSED', 'Graph closed before refresh could publish');
      if (sourceFailed) return failed('CG_RELOAD_FAILED', 'One or more Provider sources failed validation');
      let next: Snapshot;
      try { next = new Snapshot(candidates, this.#allowed); }
      catch (error) {
        const e = error instanceof GraphError ? error : new GraphError('CG_RELOAD_FAILED', 'lifecycle', 'Graph refresh failed', 'retry');
        return failed(e.code, e.message);
      }
      if (this.#closed) return failed('CG_GRAPH_CLOSED', 'Graph closed before refresh could publish');
      this.#snapshot = next;
      for (const status of statuses.values()) if (status.status === 'not_applied') status.status = 'updated';
      return { ok: true, revision: next.revision, providers: visibleStatuses() };
    };
    const operation = this.#reloadTail.then(execute);
    this.#reloadTail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async match(query: MatchQuery, options?: MatchOptions): Promise<MatchResult> {
    const begun = performance.now(); const snapshot = this.#current();
    let q: Record<string, unknown>; let ctx: MatchContext;
    try { q = queryObject(query, ['input', 'context', 'providers'], 'match'); ctx = this.#context(q.context); }
    catch (error) { if (error instanceof GraphError) throw new GraphError(error.code, 'match', error.message, error.nextAction); throw error; }
    if (typeof q.input !== 'string' || !q.input.trim()) fail('CG_INPUT_INVALID', 'match', 'match input must be nonempty text', 'fix_input');
    if (Buffer.byteLength(q.input, 'utf8') > this.#limits.maxInputBytes) fail('CG_INPUT_TOO_LARGE', 'match', 'Input exceeds maxInputBytes', 'fix_input');
    const settings = options === undefined ? {} : descriptors(options, 'CG_INPUT_INVALID', 'match');
    if (Object.keys(settings).some(key => !['signal', 'timeoutMs'].includes(key))) fail('CG_INPUT_INVALID', 'match', 'Unknown match option', 'fix_input');
    const timeout = settings.timeoutMs?.value === undefined ? 60000 : settings.timeoutMs.value;
    const signal: unknown = settings.signal?.value;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000 || signal !== undefined && !(signal instanceof AbortSignal)) fail('CG_INPUT_INVALID', 'match', 'Invalid match timeout or AbortSignal', 'fix_input');
    const scope = this.#scope(snapshot, q.providers, 'match');
    if (!this.#model) fail('CG_MODEL_NOT_CONFIGURED', 'match', 'match requires a ModelExecutor', 'check_config');
    if (signal instanceof AbortSignal && signal.aborted) fail('CG_MODEL_CANCELLED', 'match', 'Model selection cancelled', 'retry');
    const entries = [...snapshot.capabilities.values()].filter(c => scope.has(c.providerId)).map(catalog).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (bytes(entries) > this.#limits.maxModelCatalogBytes) fail('CG_MODEL_CONTEXT_EXCEEDED', 'match', 'Complete model catalog exceeds maxModelCatalogBytes', 'narrow_scope');
    const remaining = timeout - (performance.now() - begun);
    if (remaining <= 0) fail('CG_MODEL_TIMEOUT', 'match', 'Model selection deadline exceeded', 'retry');
    if (!entries.length) return this.#result({ status: 'no_match', selection: { ids: [], missingInformation: [] }, graph: resolveSnapshot(snapshot, [], ctx, ['requires']) }, 'match');
    const controller = new AbortController();
    let terminal: GraphError | undefined; let settled = false;
    let rejectTermination!: (error: GraphError) => void;
    const termination = new Promise<never>((_resolve, reject) => { rejectTermination = reject; });
    const terminate = (error: GraphError) => {
      if (settled || terminal) return;
      terminal = error; controller.abort(error); rejectTermination(error);
    };
    const cancel = () => terminate(new GraphError('CG_MODEL_CANCELLED', 'match', 'Model selection cancelled', 'retry'));
    const timer = setTimeout(() => terminate(new GraphError('CG_MODEL_TIMEOUT', 'match', 'Model selection deadline exceeded', 'retry')), remaining);
    this.#active.add(terminate);
    if (signal instanceof AbortSignal) signal.addEventListener('abort', cancel, { once: true });
    try {
      const request = Object.freeze({ input: q.input, context: freezeJSON(copyJSON(ctx)), catalog: freezeJSON(copyJSON(entries)), revision: snapshot.revision, signal: controller.signal });
      const operation = Promise.resolve().then(() => { if (terminal) throw terminal; return this.#model!.select(request); }).catch(error => { throw modelFailure(error); });
      const output = await Promise.race([operation, termination]);
      if (!terminal && performance.now() - begun >= timeout) terminate(new GraphError('CG_MODEL_TIMEOUT', 'match', 'Model selection deadline exceeded', 'retry'));
      if (terminal) throw terminal;
      const selection = validateSelection(output, new Set(entries.map(entry => entry.id)), this.#limits.maxModelOutputBytes);
      const status = selection.decision === 'selected' ? 'matched' : selection.decision === 'none' ? 'no_match' : selection.decision;
      const result: MatchResult = { status, selection: { ids: selection.ids, ...(selection.reason === undefined ? {} : { reason: selection.reason }), missingInformation: selection.decision === 'needs_context' ? selection.missingInformation : [] }, graph: resolveSnapshot(snapshot, selection.ids, ctx, ['requires']) };
      const bounded = this.#result(result, 'match');
      if (performance.now() - begun >= timeout) terminate(new GraphError('CG_MODEL_TIMEOUT', 'match', 'Model selection deadline exceeded', 'retry'));
      if (terminal) throw terminal;
      settled = true; return bounded;
    } catch (error) { if (terminal) throw terminal; throw error; }
    finally { settled = true; clearTimeout(timer); this.#active.delete(terminate); if (signal instanceof AbortSignal) signal.removeEventListener('abort', cancel); }
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const terminate of [...this.#active]) terminate(new GraphError('CG_GRAPH_CLOSED', 'lifecycle', 'Graph closed during model selection', 'check_config'));
  }
}
