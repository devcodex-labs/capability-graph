import path from "node:path";
import { resolveBudgets, type BudgetConfig, type BudgetOverrides } from "./budgets.js";
import { CapabilityGraphError, type ErrorShape } from "./errors.js";
import { isId } from "./identity.js";
import { computeEffectiveScope } from "./scope.js";
import { databaseAuthorityStore } from "./store/database-authority-store.js";
import { FileAuthorityStore } from "./store/file-authority-store.js";
import { memoryGraphStore } from "./store/memory-graph-store.js";
import { ProviderViewStore, FrozenGraph, type PinnedStore } from "./store/provider-view-store.js";
import type { DatabaseAuthorityAdapter, ValidatedProviderView } from "./store/types.js";
import type { ResultMeta, StaticRevision } from "./types.js";
import { validateSnapshot } from "./validate/index.js";

/** One source per enabled provider. File roots are resolved at open, independent of subsequent cwd changes. */
export type AuthoritySpec = { readonly kind: "file"; readonly rootDir: string } |
  { readonly kind: "database"; readonly adapter: DatabaseAuthorityAdapter };
export interface ProviderLoadSpec { readonly providerId: string; readonly authority: AuthoritySpec }
export interface StaticOpenConfig {
  readonly hostAllowedProviders: readonly string[];
  readonly integrationEnabledProviders: readonly string[];
  readonly providers: readonly ProviderLoadSpec[];
  readonly budgets?: BudgetOverrides;
}
/** Per-provider publication outcome, not an all-provider transaction or proof that a retained source stays readable. */
export interface ReloadResult {
  readonly ok: boolean;
  readonly providers: readonly { readonly providerId: string; readonly staticRevision?: StaticRevision;
    readonly servedFrom: "current" | "previous" | "none"; readonly refreshFailed?: boolean; readonly error?: ErrorShape }[];
}
export interface QueryContext {
  readonly graph: FrozenGraph;
  readonly scope: ReadonlySet<string>;
  readonly meta: ResultMeta;
}

export function errorShape(error: unknown, fallback = "CG_LOAD_FAILED" as const): ErrorShape {
  const value = error instanceof CapabilityGraphError ? error : new CapabilityGraphError(fallback, { nextAction: "repair_source" });
  return { code: value.code, message: value.message, nextAction: value.nextAction,
    ...(value.details === undefined ? {} : { details: value.details }) };
}

/** Owns authority handles and serialized publication; query code only receives pinned contexts. */
export class CoreHost {
  readonly budgets: BudgetConfig;
  readonly scope: ReadonlySet<string>;
  private readonly specs: readonly ProviderLoadSpec[];
  private readonly store = new ProviderViewStore();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(config: StaticOpenConfig) {
    if (!config || typeof config !== "object") throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
    const scope = computeEffectiveScope({ hostAllowed: config.hostAllowedProviders,
      integrationEnabled: config.integrationEnabledProviders, phase: "open" });
    if (!scope.ok) throw scope.error;
    this.scope = scope.scope;
    this.budgets = resolveBudgets(config.budgets);
    if (!Array.isArray(config.providers)) throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
    const seen = new Set<string>();
    const cwd = process.cwd();
    this.specs = config.providers.map((spec) => {
      if (!spec || !isId(spec.providerId) || !spec.authority) throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
      if (seen.has(spec.providerId)) throw new CapabilityGraphError("CG_DUAL_AUTHORITY", { nextAction: "configure_backend" });
      seen.add(spec.providerId);
      if (!this.scope.has(spec.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
      const authority = spec.authority;
      if ((authority.kind === "file" && typeof authority.rootDir === "string" && authority.rootDir.length && !("adapter" in authority)) ||
          (authority.kind === "database" && authority.adapter && typeof authority.adapter.openView === "function" && !("rootDir" in authority))) {
        return Object.freeze({ providerId: spec.providerId, authority: Object.freeze(authority.kind === "file"
          ? { kind: "file" as const, rootDir: path.resolve(cwd, authority.rootDir) } : { ...authority }) });
      }
      throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
    });
    // Missing authority is not a valid empty provider. Fail before opening any source handles.
    if ([...this.scope].some((id) => !seen.has(id))) {
      throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
    }
  }

  private async load(spec: ProviderLoadSpec): Promise<ValidatedProviderView> {
    try {
      if (spec.authority.kind === "database") return await databaseAuthorityStore(await spec.authority.adapter.openView(spec.providerId), spec.providerId);
      const snapshot = await validateSnapshot(await new FileAuthorityStore().load(spec.authority.rootDir));
      if (snapshot.provider.providerId !== spec.providerId) throw new CapabilityGraphError("CG_VALIDATION_FAILED", { nextAction: "repair_source" });
      return memoryGraphStore(snapshot);
    } catch (error) {
      if (error instanceof CapabilityGraphError) throw error;
      throw new CapabilityGraphError("CG_LOAD_FAILED", { nextAction: "repair_source" });
    }
  }

  static async open(config: StaticOpenConfig): Promise<CoreHost> {
    const host = new CoreHost(config);
    const candidates: ValidatedProviderView[] = [];
    try {
      for (const spec of host.specs) candidates.push(await host.load(spec));
      for (const candidate of candidates) await host.store.replaceProvider(candidate);
      return host;
    } catch (error) {
      await Promise.allSettled(candidates.map((candidate) => candidate.close()));
      throw error;
    }
  }

  assertAllowed(providerId: string): void {
    if (!isId(providerId)) throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
    if (!this.scope.has(providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  }

  /** Pin before any await; reloads can replace slots without changing this query's selected views. */
  async query<T>(request: readonly string[] | undefined, revision: string | undefined, run: (context: QueryContext) => Promise<T>): Promise<T> {
    if (this.closed) throw new CapabilityGraphError("CG_NO_ACTIVE_VIEW", { nextAction: "refresh" });
    const pin = this.store.pin();
    try {
      const scoped = computeEffectiveScope({ hostAllowed: [...this.scope], integrationEnabled: [...this.scope], request, phase: "query" });
      if (!scoped.ok) throw scoped.error;
      const scope = scoped.scope;
      const ids = [...scope].sort();
      let graph = pin.current;
      let servedFrom: ResultMeta["servedFrom"] = "current";
      if (revision !== undefined) {
        if (ids.length !== 1 || typeof revision !== "string" || !revision) throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
        const id = ids[0]!;
        if (graph.staticRevision(id) !== revision) {
          if (pin.previous?.staticRevision(id) !== revision) throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
          graph = pin.previous; servedFrom = "previous";
        }
      }
      const revisions = Object.fromEntries(ids.flatMap((id) => { const r = graph.staticRevision(id); return r === undefined ? [] : [[id, r]]; }));
      const meta: ResultMeta = { completeness: "complete", servedFrom, scope: ids, warnings: [],
        compositeStaticRevision: graph.compositeStaticRevision(ids),
        ...(ids.length === 1 && revisions[ids[0]!] ? { staticRevision: revisions[ids[0]!] } : {}),
        ...(ids.length > 1 ? { staticRevisionByProvider: revisions } : {}),
        ...(ids.some((id) => pin.failedProviders.has(id)) ? { refreshFailed: true } : {}) };
      const read = async <V>(operation: () => Promise<V>): Promise<V> => {
        try { return await operation(); }
        catch (error) {
          if (error instanceof CapabilityGraphError && error.code !== "CG_NO_ACTIVE_VIEW" && error.code !== "CG_REVISION_MISMATCH") throw error;
          throw new CapabilityGraphError(revision === undefined ? "CG_NO_ACTIVE_VIEW" : "CG_REVISION_MISMATCH", { nextAction: "refresh" });
        }
      };
      const views = new Map<string, ValidatedProviderView>();
      for (const id of ids) {
        const source = graph.getView(id);
        if (!source) continue;
        // Authorization does not make every provider a dependency. Probe lazily and only cache within this query.
        let readable: Promise<void> | undefined;
        const assertReadable = () => readable ??= read(async () => { await source.assertReadable?.(); });
        const fromView = async <V>(operation: () => Promise<V>): Promise<V> => { await assertReadable(); return read(operation); };
        views.set(id, { ...source, assertReadable, getCapability: (key) => fromView(() => source.getCapability(key)),
          listCapabilities: (page) => fromView(() => source.listCapabilities(page)),
          neighbors: (key, kind, page) => fromView(() => source.neighbors(key, kind, page)) });
      }
      // Explicit revision is a query-level promise, even when a retriever later returns no candidates.
      // Point reads still pass through read() so failures after this probe retain revision-mismatch semantics.
      if (revision !== undefined) await views.get(ids[0]!)?.assertReadable?.();
      return await run({ graph: new FrozenGraph(views), scope, meta });
    } finally { await pin.release(); }
  }

  /** Validate before publishing each provider; refresh failure records status without discarding current/previous. */
  reload(options: { providerId?: string } = {}): Promise<ReloadResult> {
    if (this.closed) return Promise.reject(new CapabilityGraphError("CG_NO_ACTIVE_VIEW", { nextAction: "refresh" }));
    if (options.providerId !== undefined) this.assertAllowed(options.providerId);
    const specs = options.providerId === undefined ? this.specs : this.specs.filter((spec) => spec.providerId === options.providerId);
    if (options.providerId !== undefined && !specs.length) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
    const task = this.queue.then(async () => {
      const providers: ReloadResult["providers"][number][] = [];
      for (const spec of specs) {
        try {
          const next = await this.load(spec);
          await this.store.replaceProvider(next);
          providers.push({ providerId: spec.providerId, staticRevision: next.staticRevision, servedFrom: "current" });
        } catch (error) {
          this.store.markRefreshFailed(spec.providerId);
          const pin: PinnedStore = this.store.pin();
          try { providers.push({ providerId: spec.providerId, staticRevision: pin.current.staticRevision(spec.providerId),
            servedFrom: pin.current.getProvider(spec.providerId) ? "current" : "none", refreshFailed: true, error: errorShape(error) }); }
          finally { await pin.release(); }
        }
      }
      return { ok: providers.every((provider) => !provider.error), providers };
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    await this.store.close();
  }
}
