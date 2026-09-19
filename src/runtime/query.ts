import type { BudgetConfig } from "../budgets.js";
import type { QueryContext } from "../core-host.js";
import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { equalId, formatQualifiedId } from "../identity.js";
import { bytes, capability, identity, inputInvalid, limit } from "../query/common.js";
import { decodeCursor, encodeCursor, type CursorBinding } from "../query/cursor.js";
import { contract, warning } from "../retrieval/common.js";
import type { ResultMeta } from "../types.js";
import { freeze } from "../validate/values.js";
import type { QueryRuntimePage, QueryRuntimeQuery, RuntimeAdapter, RuntimeAdapterResult, RuntimeAssociation, RuntimeInstance, RuntimeObservation } from "./types.js";

const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
export function validateRuntimeQuery(query: QueryRuntimeQuery): void {
  if (!query || !nonempty(query.project) || !nonempty(query.environment)) throw new CapabilityGraphError("CG_RUNTIME_CONTEXT_REQUIRED", { nextAction: "fix_input" });
  if ((query.instanceId !== undefined && !nonempty(query.instanceId)) || (query.requiredRuntimeRevision !== undefined && !nonempty(query.requiredRuntimeRevision))) inputInvalid();
}
function observation(raw: RuntimeObservation): RuntimeObservation {
  if (!raw || !nonempty(raw.source) || !nonempty(raw.observedAt) || !Number.isFinite(Date.parse(raw.observedAt)) ||
      !nonempty(raw.runtimeRevision) || !nonempty(raw.observedAgainstStaticRevision) ||
      !["compatible", "unknown", "refresh_required"].includes(raw.compatibility) ||
      !["available", "empty", "partial"].includes(raw.availability) || !["current", "stale"].includes(raw.freshness) ||
      [raw.sourceIdentity, raw.coverage, raw.freshnessLimit].some((value) => value !== undefined && !nonempty(value))) contract("runtime_observation_invalid");
  return { source: raw.source, observedAt: raw.observedAt, runtimeRevision: raw.runtimeRevision, observedAgainstStaticRevision: raw.observedAgainstStaticRevision,
    compatibility: raw.compatibility, availability: raw.availability, freshness: raw.freshness,
    ...(raw.sourceIdentity === undefined ? {} : { sourceIdentity: raw.sourceIdentity }), ...(raw.coverage === undefined ? {} : { coverage: raw.coverage }),
    ...(raw.freshnessLimit === undefined ? {} : { freshnessLimit: raw.freshnessLimit }) };
}
function facts(raw: Readonly<Record<string, unknown>>, maxBytes: number): Readonly<Record<string, unknown>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) contract("runtime_facts_invalid");
  const json = canonicalJson(raw);
  if (Buffer.byteLength(json, "utf8") > maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return JSON.parse(json) as Readonly<Record<string, unknown>>;
}
/** Bound waiting, not adapter execution: the adapter still owns cancellation and resource cleanup. */
async function invoke(adapter: RuntimeAdapter, input: Parameters<RuntimeAdapter["query"]>[0], timeoutMs: number): Promise<RuntimeAdapterResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // race attaches rejection handlers to both inputs, including a losing adapter's late rejection.
    return await Promise.race([Promise.resolve().then(() => adapter.query(input)), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("runtime timeout")), timeoutMs);
    })]);
  } catch { throw new CapabilityGraphError("CG_RUNTIME_UNAVAILABLE", { nextAction: "repair_source" }); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Validate one provider/project/environment observation without adding instances to the static graph. */
export async function queryRuntime(context: QueryContext, query: QueryRuntimeQuery, budgets: BudgetConfig, adapters: ReadonlyMap<string, RuntimeAdapter>, bound?: string): Promise<QueryRuntimePage> {
  validateRuntimeQuery(query);
  if (context.scope.size !== 1) inputInvalid();
  const providerId = [...context.scope][0]!;
  const revision = context.graph.staticRevision(providerId);
  if (!revision) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  await context.graph.getView(providerId)!.assertReadable?.();
  const target = query.instanceOf === undefined ? undefined : (await capability(context, query.instanceOf, bound)).id;
  const adapter = adapters.get(providerId);
  if (!adapter) throw new CapabilityGraphError("CG_RUNTIME_DISABLED", { nextAction: "configure_backend" });
  const count = limit(query.limit, budgets.runtime.defaultPageSize, budgets.runtime.maxPageSize);
  const binding: CursorBinding = { kind: "runtime", staticRevision: context.meta.compositeStaticRevision,
    filter: { providerId, project: query.project, environment: query.environment, instanceOf: target ?? null, instanceId: query.instanceId ?? null, limit: count } };
  const cursor = decodeCursor(query.cursor, binding);
  if (cursor && !cursor.runtimeRevision) inputInvalid();
  if (cursor && query.requiredRuntimeRevision !== undefined && cursor.runtimeRevision !== query.requiredRuntimeRevision) throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
  const raw = await invoke(adapter, { project: query.project, environment: query.environment, currentStaticRevision: revision, limit: count,
    ...(target === undefined ? {} : { instanceOf: target }), ...(query.instanceId === undefined ? {} : { instanceId: query.instanceId }),
    ...(cursor === undefined ? {} : { cursor: cursor.after }) }, budgets.runtime.timeoutMs);
  if (!raw || !Array.isArray(raw.instances) || raw.instances.length > count ||
      (raw.nextCursor !== undefined && (!nonempty(raw.nextCursor) || raw.nextCursor === cursor?.after))) contract("runtime_page_invalid");
  const observed = observation(raw.observation);
  if ((query.requiredRuntimeRevision !== undefined && observed.runtimeRevision !== query.requiredRuntimeRevision) ||
      (cursor !== undefined && observed.runtimeRevision !== cursor.runtimeRevision)) throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
  if ((observed.availability === "empty" && (raw.instances.length || raw.nextCursor !== undefined)) ||
      (observed.availability === "available" && !raw.instances.length)) contract("inconsistent_runtime_observation");
  const seen = new Set<string>();
  for (const instance of raw.instances) {
    if (instance && [instance.providerId, instance.project, instance.environment, instance.instanceId].every(nonempty)) {
      const key = canonicalJson([instance.providerId, instance.project, instance.environment, instance.instanceId]);
      if (seen.has(key)) contract("duplicate_runtime_instance"); seen.add(key);
    }
  }
  const items: RuntimeInstance[] = []; const warnings: ResultMeta["warnings"][number][] = [];
  for (const [index, instance] of raw.instances.entries()) {
    try {
      if (!instance || !nonempty(instance.instanceId)) contract("runtime_instance_invalid");
      if (instance.providerId !== providerId || !context.scope.has(instance.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
      const type = identity(instance.instanceOf);
      if (instance.project !== query.project || instance.environment !== query.environment || type.providerId !== providerId ||
          (query.instanceId !== undefined && instance.instanceId !== query.instanceId) || (target && !equalId(type, target))) {
        throw new CapabilityGraphError("CG_RUNTIME_RESULT_MISMATCH", { nextAction: "fix_input" });
      }
      await capability(context, type);
      const projectedFacts = facts(instance.facts, budgets.runtime.maxFactsBytes);
      let associations: RuntimeAssociation[] | undefined;
      if (instance.associations !== undefined) {
        if (!Array.isArray(instance.associations)) contract("runtime_associations_invalid");
        if (Buffer.byteLength(canonicalJson(instance.associations), "utf8") > budgets.runtime.maxAssociationBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
        associations = instance.associations.map((association: RuntimeAssociation) => {
          if (!association || !nonempty(association.kind) || (association.targetInstanceId !== undefined && !nonempty(association.targetInstanceId))) contract("runtime_association_invalid");
          return { kind: association.kind, ...(association.targetInstanceId === undefined ? {} : { targetInstanceId: association.targetInstanceId }),
            ...(association.facts === undefined ? {} : { facts: facts(association.facts, budgets.runtime.maxAssociationBytes) }) };
        });
      }
      items.push(freeze({ instanceId: instance.instanceId, providerId, project: instance.project, environment: instance.environment,
        instanceOf: type, facts: projectedFacts, ...(associations === undefined ? {} : { associations }) }));
    } catch (error) {
      if (error instanceof CapabilityGraphError && ["CG_NO_ACTIVE_VIEW", "CG_REVISION_MISMATCH"].includes(error.code)) throw error;
      warnings.push(warning(error instanceof CapabilityGraphError ? error.code : "CG_ADAPTER_CONTRACT_INVALID", index));
    }
  }
  // All rejected instances mean a broken adapter response, not an observed empty environment.
  if (raw.instances.length && !items.length) throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: {
    reason: "all_runtime_items_rejected", receivedCount: raw.instances.length, rejectedCount: raw.instances.length,
  } });
  const nextCursor = raw.nextCursor === undefined ? undefined : encodeCursor(binding, raw.nextCursor, observed.runtimeRevision);
  const types = new Map(items.map((item) => [formatQualifiedId(item.instanceOf), item.instanceOf]));
  if (target) types.set(formatQualifiedId(target), target);
  return { items, observation: observed, ...(nextCursor === undefined ? {} : { nextCursor }), meta: { ...context.meta, warnings,
    completeness: warnings.length || observed.availability === "partial" ? "partial" : nextCursor ? "truncated" : "complete",
    budgets: { "runtime.maxPageSize": count, "runtime.maxFactsBytes": budgets.runtime.maxFactsBytes, "runtime.maxAssociationBytes": budgets.runtime.maxAssociationBytes },
    view: { capabilities: [...types.values()].map((id) => ({ id, staticRevision: revision })), runtime: { runtimeRevision: observed.runtimeRevision,
      observedAgainstStaticRevision: observed.observedAgainstStaticRevision, queriedStaticRevision: revision, compatibility: observed.compatibility } } } };
}
