import type { ErrorShape } from "./errors.js";

/** The only logical capability identity; provider versions are not identity. */
export interface CanonicalCapabilityId {
  readonly providerId: string;
  readonly capabilityId: string;
}

export type QualifiedCapabilityId = string;
export type StaticRevision = string;
export type RuntimeRevision = string;
export type KnowledgeContentId = string;
export type RuntimeCompatibility = "compatible" | "unknown" | "refresh_required";

export type KnowledgeLocator =
  | { readonly type: "relative-file"; readonly path: string }
  | { readonly type: "http"; readonly url: string };

export type KnowledgeKind = "document" | "collection";
export interface KnowledgeDocumentRef {
  readonly kind: "document";
  readonly knowledgeId: string;
  readonly locator: KnowledgeLocator;
  readonly role: string;
  readonly locale?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly canonicalUrl?: string;
}
export interface KnowledgeCollectionRef {
  readonly kind: "collection";
  readonly knowledgeId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly members: readonly KnowledgeDocumentRef[];
}
export type KnowledgeRef = KnowledgeDocumentRef | KnowledgeCollectionRef;
/** Provider-owned Specification identity/applicability metadata; Core does not store its body or enforce its instructions. */
export interface SpecificationMetadata {
  readonly specificationId: string;
  readonly version: string;
  readonly appliesTo?: { readonly software?: string; readonly versionRange?: string; readonly conditions?: string };
  readonly documents: readonly KnowledgeDocumentRef[];
}
export interface ProviderRecord {
  readonly providerId: string;
  readonly name: string;
  readonly version: string;
  readonly specification?: SpecificationMetadata;
  readonly authorityKind: "file" | "database";
}
export type NeighborKind = "parents" | "children" | "specializes" | "specializedBy" | "related" | "relatedBy" | "requires" | "requiredBy";
export interface StaticCapability {
  readonly id: CanonicalCapabilityId;
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly distinction?: string;
  readonly examples: readonly string[];
  readonly parents: readonly CanonicalCapabilityId[];
  readonly specializes: readonly CanonicalCapabilityId[];
  readonly related: readonly CanonicalCapabilityId[];
  readonly requires: readonly CanonicalCapabilityId[];
  readonly knowledge: readonly KnowledgeRef[];
  readonly staticRevision: StaticRevision;
}

/** Actual source identities used by a query, not a cross-source transaction. */
export interface CurrentCapabilityView {
  readonly capabilities: readonly {
    readonly id: CanonicalCapabilityId;
    readonly staticRevision: StaticRevision;
  }[];
  readonly runtime?: {
    readonly runtimeRevision: RuntimeRevision;
    readonly observedAgainstStaticRevision: StaticRevision;
    readonly queriedStaticRevision: StaticRevision;
    readonly compatibility: RuntimeCompatibility;
  };
  readonly knowledge?: readonly {
    readonly id: CanonicalCapabilityId;
    readonly knowledgeId: string;
    readonly contentId: KnowledgeContentId;
  }[];
}

/** Provenance and response completeness; a successful call can still contain warnings or require another page. */
export interface ResultMeta {
  /** complete: no omission; truncated: continue paging; partial: inspect rejected items/warnings. */
  readonly completeness: "complete" | "truncated" | "partial";
  readonly compositeStaticRevision: string;
  readonly staticRevision?: StaticRevision;
  readonly staticRevisionByProvider?: Readonly<Record<string, StaticRevision>>;
  readonly servedFrom: "current" | "previous" | "mixed";
  readonly servedFromByProvider?: Readonly<Record<string, "current" | "previous">>;
  /** A refresh failed; this response still comes from the named readable view, not an unmarked fallback. */
  readonly refreshFailed?: boolean;
  readonly scope: readonly string[];
  readonly filter?: Readonly<Record<string, unknown>>;
  readonly view?: CurrentCapabilityView;
  readonly warnings: readonly {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }[];
  readonly budgets?: Readonly<Record<string, number>>;
}

/** Failures retain their input slot instead of disappearing from a batch. */
export type BatchItem<T> =
  | { readonly inputIndex: number; readonly ok: true; readonly value: T }
  | { readonly inputIndex: number; readonly ok: false; readonly error: ErrorShape };

export interface BatchResult<T> {
  readonly results: readonly BatchItem<T>[];
  readonly meta: ResultMeta;
}
