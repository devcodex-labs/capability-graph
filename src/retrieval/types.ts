import type { CapabilityRef, ProviderListQuery } from "../query/types.js";
import type { CanonicalCapabilityId, ResultMeta } from "../types.js";
import type { KnowledgeResultHit } from "../knowledge/types.js";
export interface RetrieveCapabilitiesQuery extends ProviderListQuery { readonly text: string; readonly limit?: number }
/** rank is the original one-based adapter position; rejected candidates leave gaps and scores are not normalized. */
export interface CapabilityCandidate { readonly id: CanonicalCapabilityId; readonly qualifiedId: string; readonly score?: number; readonly rank: number }
export interface RetrieveCapabilitiesPage { readonly items: readonly CapabilityCandidate[]; readonly meta: ResultMeta }
/** Nonempty explicit capability selection; knowledgeIds narrows declared Documents/Collections, never graph neighbors. */
export interface QueryKnowledgeQuery extends RetrieveCapabilitiesQuery { readonly selected: readonly CapabilityRef[];
  readonly knowledgeIds?: readonly string[]; readonly roles?: readonly string[]; readonly locales?: readonly string[] }
export interface QueryKnowledgePage {
  readonly items: readonly KnowledgeResultHit[];
  readonly knowledgeState: "searched" | "empty_collection" | "filtered_empty";
  readonly indexStatus?: { readonly mappingRevision: string; readonly observedAt: string; readonly freshness: "current"; readonly validatedDocuments: number };
  readonly meta: ResultMeta;
}
