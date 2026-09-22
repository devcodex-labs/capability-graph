import type { ProviderSourceContext } from "../store/types.js";
import type { CanonicalCapabilityId, KnowledgeContentId, KnowledgeDocumentRef, KnowledgeLocator, KnowledgeRef, StaticRevision } from "../types.js";
/** Local Reader-only context. Never serialize sourceContext into a retriever request or public response. */
export interface KnowledgeReadContext {
  readonly providerId: string; readonly staticRevision: StaticRevision; readonly sourceContext: ProviderSourceContext;
}
/** Optional source reader; the built-in local reader always handles relative-file Documents first. */
export interface KnowledgeReader {
  readonly id: string;
  /** Synchronous source match. Core picks the first matching custom reader only for nonlocal sources. */
  canRead(ref: KnowledgeRef): boolean;
  /** Return exact bounded bytes and their k: content hash; source must equal the declared locator. Own I/O cleanup here. */
  read(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, budget: { maxBytes: number }): Promise<{
    bytes: Uint8Array; contentType: string; contentId: KnowledgeContentId; source: string;
  }>;
}
/** Invalidation contract for integrations; Core does not automatically dispatch invalidate callbacks in V1. */
export interface SourceChange {
  readonly providerId: string; readonly staticRevision: StaticRevision;
  readonly reason: "metadata" | "relations" | "knowledge_body" | "knowledge_mapping" | "configuration" | "runtime" | "identity_replaced";
}
/** Transport-safe, explicitly selected Document or Collection member; contains no absolute knowledge root. */
export interface KnowledgeSearchTarget {
  readonly id: CanonicalCapabilityId; readonly knowledgeId: string; readonly locator: KnowledgeLocator; readonly viaCollectionIds: readonly string[];
  readonly role: string; readonly locale?: string; readonly title?: string; readonly summary?: string; readonly canonicalUrl?: string;
}
/** Query-scoped access, not a general filesystem reader. Saved access cannot start reads after retrieve settles. */
export interface KnowledgeRetrievalAccess {
  /** Read only a listed identity/knowledgeId pair, without replacing its locator; maxBytes is capped by Core. */
  read(target: Pick<KnowledgeSearchTarget, "id" | "knowledgeId">, budget: { maxBytes: number }): ReturnType<KnowledgeReader["read"]>;
}
/** Prove mapping, configuration and content freshness for all targets, including queries returning zero hits. */
export interface KnowledgeIndexEvidence {
  /** Exactly the providers represented in this request's final targets, not the entire authorized scope. */
  readonly staticRevisionByProvider: Readonly<Record<string, StaticRevision>>;
  readonly mappingRevision: string; readonly observedAt: string; readonly freshness: "current" | "stale" | "unknown";
  readonly sourceConfigRevision: string; readonly indexedConfigRevision: string;
  readonly documents: readonly { readonly id: CanonicalCapabilityId; readonly knowledgeId: string;
    readonly sourceContentId: KnowledgeContentId; readonly indexedContentId: KnowledgeContentId }[];
}
/** Traceable UTF-8 snippet: offsets are byte offsets, end-exclusive, not JavaScript character indexes. */
export interface KnowledgeHit {
  readonly id: CanonicalCapabilityId; readonly knowledgeId: string; readonly contentId: KnowledgeContentId;
  readonly source: string; readonly startOffset: number; readonly endOffset: number; readonly snippet: string; readonly score?: number;
}
/** Core-enriched hit metadata comes from the validated mapping, never the Retriever payload. */
export interface KnowledgeResultHit extends KnowledgeHit {
  readonly role: string; readonly locale?: string; readonly title?: string; readonly summary?: string; readonly canonicalUrl?: string;
}
/** Optional knowledge search contract; actual indexing/backends are integration-owned. */
export interface KnowledgeRetriever {
  readonly id: string;
  /** Return bounded hits/evidence for final targets. Revisions cover only their providers; access cannot expand relations. */
  retrieve(input: { text: string; staticRevisionByProvider: Readonly<Record<string, StaticRevision>>;
    mappingRevision: string; targets: readonly KnowledgeSearchTarget[]; limit: number }, access: KnowledgeRetrievalAccess):
    Promise<{ hits: readonly KnowledgeHit[]; evidence: KnowledgeIndexEvidence }>;
  invalidate?(change: SourceChange): Promise<void>;
}
/** Optional candidate recall; Core checks identity, scope and source revision rather than trusting ranking output. */
export interface CapabilityRetriever {
  readonly id: string;
  /** Return existing identities with observed static revisions, in ranking order; no new capabilities or graph edges. */
  retrieve(input: { text: string; providerIds: readonly string[]; staticRevisionByProvider: Readonly<Record<string, StaticRevision>>; limit: number }):
    Promise<{ candidates: readonly { id: CanonicalCapabilityId; score?: number; sourceStaticRevision: StaticRevision }[] }>;
  invalidate?(change: SourceChange): Promise<void>;
}
export type DiscoveryAdapter = CapabilityRetriever;
