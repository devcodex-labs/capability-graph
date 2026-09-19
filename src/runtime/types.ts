import type { CapabilityRef } from "../query/types.js";
import type { SourceChange } from "../knowledge/types.js";
import type { CanonicalCapabilityId, ResultMeta, RuntimeCompatibility } from "../types.js";
/** Runtime-only context; not a static relation and not a complete runtime graph. */
export interface RuntimeAssociation {
  readonly kind: string; readonly targetInstanceId?: string; readonly facts?: Readonly<Record<string, unknown>>;
}
/** Instance identity includes provider, project, environment and instanceId; instanceOf names a static capability. */
export interface RuntimeInstance {
  readonly instanceId: string; readonly providerId: string; readonly project: string; readonly environment: string;
  readonly instanceOf: CanonicalCapabilityId; readonly facts: Readonly<Record<string, unknown>>; readonly associations?: readonly RuntimeAssociation[];
}
/** Adapter-observed state and provenance. Core never infers compatibility merely from matching IDs or revisions. */
export interface RuntimeObservation {
  readonly source: string; readonly observedAt: string; readonly sourceIdentity?: string;
  readonly runtimeRevision: string; readonly observedAgainstStaticRevision: string; readonly compatibility: RuntimeCompatibility;
  readonly availability: "available" | "empty" | "partial"; readonly freshness: "current" | "stale";
  readonly coverage?: string; readonly freshnessLimit?: string;
}
export interface RuntimeAdapterResult { readonly instances: readonly RuntimeInstance[]; readonly observation: RuntimeObservation; readonly nextCursor?: string }
/** One explicit runtime source per provider; network access, refresh and resource cleanup belong to the adapter. */
export interface RuntimeAdapter {
  readonly id: string; readonly providerId: string;
  /**
   * Return a bounded context-specific page with source observation. Core timeout limits waiting, not execution.
   * Own cancellation/timeouts inside the adapter; no AbortSignal or automatic invalidation is provided in V1.
   */
  query(input: { project: string; environment: string; instanceOf?: CanonicalCapabilityId; instanceId?: string;
    currentStaticRevision: string; limit: number; cursor?: string }): Promise<RuntimeAdapterResult>;
  invalidate?(change: SourceChange): Promise<void>;
}
/** Explicit runtime context; cursor/required revisions reject drift instead of silently switching observations. */
export interface QueryRuntimeQuery {
  readonly project: string; readonly environment: string; readonly instanceOf?: CapabilityRef; readonly instanceId?: string;
  readonly requestProviderScope?: readonly string[]; readonly requiredRuntimeRevision?: string; readonly requiredStaticRevision?: string;
  readonly cursor?: string; readonly limit?: number;
}
export interface QueryRuntimePage {
  readonly items: readonly RuntimeInstance[]; readonly observation: RuntimeObservation; readonly meta: ResultMeta; readonly nextCursor?: string;
}
