import type { CanonicalCapabilityId, KnowledgeDocumentRef, NeighborKind, ProviderRecord, StaticCapability, StaticRevision } from "../types.js";

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
}
export interface ProviderSourceContext {
  readonly providerId: string;
  readonly authorityKind: "file" | "database";
  readonly sourceRevision: string;
  /** Private absolute root captured for this view; never include it in public query output. */
  readonly knowledgeRootDir?: string;
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
/** Creates isolated authority read handles; not a CRUD/ORM interface or a derived cache. */
export interface DatabaseAuthorityAdapter {
  readonly id: string;
  /** Open a stable source revision. Core owns the returned handle and closes it on failed validation or retirement. */
  openView(providerId: string): Promise<DatabaseReadView>;
}
/**
 * One immutable logical database snapshot. Provider metadata, root, sourceRevision and records must stay stable.
 * Core retains IDs/digests rather than definitions; repeated point reads must reproduce the scanned records.
 */
export interface DatabaseReadView {
  readonly provider: UnvalidatedProviderRecord;
  readonly sourceRevision: string;
  /** Relative roots resolve once when Core receives this view, before validation awaits; the declaration must stay stable. */
  readonly knowledgeRootDir?: string;
  /** Return this view's record or undefined for an absent ID; throw when the view itself is no longer readable. */
  getCapability(capabilityId: string): Promise<UnvalidatedCapabilityRecord | undefined>;
  /** Scan every record exactly once in strict capabilityId order; pages and advancing cursors must respect budgets. */
  scanCapabilities(page: StorePageRequest): Promise<StorePage<UnvalidatedCapabilityRecord>>;
  /** Return sorted, unique, same-provider endpoints; reverse kinds must be justified by stored forward edges. */
  neighbors(capabilityId: string, kind: NeighborKind, page: StorePageRequest): Promise<StorePage<CanonicalCapabilityId>>;
  /** Release this handle's resources. Core delays retirement while a query still holds a pin. */
  close(): Promise<void>;
}
/** Internal authority abstraction shared by memory and database views; never a public source-write API. */
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
