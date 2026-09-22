import type { CanonicalCapabilityId, KnowledgeDocumentRef, NeighborKind, ProviderRecord, QualifiedCapabilityId, ResultMeta, StaticCapability, StaticRevision } from "../types.js";

/** Short object form is valid only with a bound provider; unbound calls require a canonical identity. */
export type CapabilityRef = CanonicalCapabilityId | { readonly capabilityId: string };
/** Scope only narrows host/integration access. requiredStaticRevision requires exactly one effective provider. */
export interface ProviderListQuery { readonly requestProviderScope?: readonly string[]; readonly requiredStaticRevision?: StaticRevision }
export interface ProviderSummary extends Omit<ProviderRecord, "specification"> {
  readonly specification?: Omit<NonNullable<ProviderRecord["specification"]>, "documents"> & { readonly documentCount: number };
  readonly staticRevision: StaticRevision;
}
export interface ProviderResult extends ProviderSummary {
  readonly specificationDocuments?: { readonly items: readonly KnowledgeDocumentRef[]; readonly completeness: "complete" | "truncated"; readonly nextCursor?: string };
  readonly meta: ResultMeta;
}
export interface ProviderSummaryPage { readonly items: readonly ProviderSummary[]; readonly meta: ResultMeta }
/** Filters affect discovery, not authorization. Cursor continuation must preserve all filters and page limits. */
export interface CatalogQuery extends ProviderListQuery {
  readonly capabilityIdPrefix?: string; readonly parent?: CapabilityRef; readonly cursor?: string; readonly limit?: number;
}
export interface CatalogRecord extends Pick<StaticCapability, "id" | "name" | "description" | "whenToUse" | "distinction" | "staticRevision"> {
  readonly qualifiedId: QualifiedCapabilityId; readonly providerId: string;
}
export interface CatalogPage { readonly items: readonly CatalogRecord[]; readonly meta: ResultMeta; readonly nextCursor?: string }
/** Bounded neighbor summaries and knowledge references; neither recursively loads related nodes nor reads bodies. */
export interface CapabilityDetailQuery {
  readonly requiredStaticRevision?: StaticRevision; readonly neighborLimitPerKind?: number; readonly knowledgeLimit?: number;
  readonly knowledgeCursors?: Readonly<Record<QualifiedCapabilityId, string>>;
}
export interface NeighborSummaryGroup {
  readonly items: readonly { readonly id: CanonicalCapabilityId; readonly name: string }[];
  readonly completeness: "complete" | "truncated";
}
export type KnowledgeSummary = KnowledgeDocumentRef | { readonly kind: "collection"; readonly knowledgeId: string;
  readonly title?: string; readonly summary?: string; readonly memberCount: number };
export interface CapabilityDetail extends Pick<StaticCapability, "id" | "name" | "description" | "whenToUse" | "distinction" | "staticRevision" | "examples"> {
  readonly qualifiedId: QualifiedCapabilityId;
  readonly knowledge: { readonly items: readonly KnowledgeSummary[]; readonly completeness: "complete" | "truncated"; readonly nextCursor?: string };
  readonly neighborSummaries: Readonly<Record<NeighborKind, NeighborSummaryGroup>>;
}
/** Each relation kind has independent pagination; inspect both group completeness and page warnings. */
export interface NeighborQuery {
  readonly kinds?: readonly NeighborKind[]; readonly limitPerKind?: number;
  readonly cursors?: Partial<Record<NeighborKind, string>>; readonly requiredStaticRevision?: StaticRevision;
}
export interface NeighborGroup { readonly items: readonly CatalogRecord[]; readonly completeness: "complete" | "truncated" | "partial"; readonly nextCursor?: string }
export interface NeighborPage { readonly id: CanonicalCapabilityId; readonly groups: Readonly<Record<NeighborKind, NeighborGroup>>; readonly meta: ResultMeta }

export interface DocumentPageQuery { readonly cursor?: string; readonly limit?: number; readonly requiredStaticRevision?: StaticRevision }
export interface KnowledgeMembersQuery extends DocumentPageQuery { readonly capability: CapabilityRef; readonly collectionId: string }
export interface KnowledgeMembersPage { readonly id: CanonicalCapabilityId; readonly collectionId: string;
  readonly items: readonly KnowledgeDocumentRef[]; readonly completeness: "complete" | "truncated";
  readonly nextCursor?: string; readonly meta: ResultMeta }
export interface SpecificationDocumentsPage { readonly providerId: string; readonly items: readonly KnowledgeDocumentRef[];
  readonly completeness: "complete" | "truncated"; readonly nextCursor?: string; readonly meta: ResultMeta }

export interface ResolveSelectionQuery {
  readonly selected: readonly CanonicalCapabilityId[];
  readonly requestProviderScope?: readonly string[];
  readonly requiredStaticRevisionByProvider?: Readonly<Record<string, StaticRevision>>;
}
export interface SelectionReason { readonly requested: boolean; readonly requiredBy: readonly CanonicalCapabilityId[] }
export interface SelectionResult {
  readonly requested: readonly CanonicalCapabilityId[];
  readonly resolved: readonly CanonicalCapabilityId[];
  readonly added: readonly CanonicalCapabilityId[];
  readonly requiresEdges: readonly { readonly from: CanonicalCapabilityId; readonly to: CanonicalCapabilityId }[];
  readonly reasons: readonly { readonly id: CanonicalCapabilityId; readonly reason: SelectionReason }[];
  readonly meta: ResultMeta;
}
