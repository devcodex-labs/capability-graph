import type { CanonicalCapabilityId, KnowledgeDocumentRef, NeighborKind, ProviderRecord, StaticCapability, StaticRevision } from "../types.js";
import type { BoundKnowledgeRoots } from "../knowledge/roots.js";

export interface UnvalidatedProviderRecord {
  readonly providerId: string;
  readonly name: string;
  readonly version: string;
  readonly specification?: {
    readonly specificationId: string;
    readonly version: string;
    readonly appliesTo?: {
      readonly software?: string;
      readonly versionRange?: string;
      readonly conditions?: string;
    };
    readonly documents: readonly KnowledgeDocumentRef[];
  };
}

/** Relations remain source JSON until the later model validator resolves them. */
export interface UnvalidatedCapabilityRecord {
  readonly capabilityId: string;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly distinction?: string;
  readonly examples?: readonly string[];
  readonly parents?: readonly unknown[];
  readonly specializes?: readonly unknown[];
  readonly related?: readonly unknown[];
  readonly requires?: readonly unknown[];
  readonly knowledge?: readonly unknown[];
}

export interface UnvalidatedProviderSnapshot {
  readonly source: { readonly kind: "file"; readonly rootDir: string };
  readonly provider: UnvalidatedProviderRecord;
  readonly capabilities: readonly UnvalidatedCapabilityRecord[];
  readonly knowledgeRootDir?: string;
  readonly knowledgeRoots?: BoundKnowledgeRoots;
}
export interface ProviderSourceContext {
  readonly providerId: string;
  readonly authorityKind: "file";
  readonly sourceRevision: string;
  /** Private absolute root captured for this view; never include it in public query output. */
  readonly knowledgeRootDir?: string;
  readonly knowledgeRoots?: BoundKnowledgeRoots;
}
export interface ValidatedProviderSnapshot {
  readonly provider: ProviderRecord;
  readonly capabilities: ReadonlyMap<string, StaticCapability>;
  readonly staticRevision: StaticRevision;
  readonly loadedAt: string;
  readonly sourceContext: ProviderSourceContext;
}

/** Both item count and serialized UTF-8 page bytes are bounded; cursors belong to this read view. */
export interface StorePageRequest {
  readonly limit: number;
  readonly maxBytes: number;
  readonly cursor?: string;
}
export interface StorePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}
/** Internal validated file view; never a public source-write API. */
export interface ValidatedProviderView {
  readonly provider: ProviderRecord;
  readonly staticRevision: StaticRevision;
  readonly sourceContext: ProviderSourceContext;
  assertReadable?(): Promise<void>;
  getCapability(capabilityId: string): Promise<StaticCapability | undefined>;
  listCapabilities(page: StorePageRequest): Promise<StorePage<StaticCapability>>;
  neighbors(capabilityId: string, kind: NeighborKind, page: StorePageRequest): Promise<StorePage<CanonicalCapabilityId>>;
  close(): Promise<void>;
}
