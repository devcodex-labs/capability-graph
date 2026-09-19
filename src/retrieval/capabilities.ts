import type { BudgetConfig } from "../budgets.js";
import type { QueryContext } from "../core-host.js";
import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { formatQualifiedId } from "../identity.js";
import type { CapabilityRetriever } from "../knowledge/types.js";
import { capability, limit } from "../query/common.js";
import type { ResultMeta, StaticCapability } from "../types.js";
import { contract, invoke, queryText, revisions, warning } from "./common.js";
import type { CapabilityCandidate, RetrieveCapabilitiesPage, RetrieveCapabilitiesQuery } from "./types.js";

/** Validate recalled identities against the pinned authority without changing adapter ranking. */
export async function retrieveCapabilities(context: QueryContext, query: RetrieveCapabilitiesQuery, budgets: BudgetConfig, retriever?: CapabilityRetriever): Promise<RetrieveCapabilitiesPage> {
  queryText(query.text);
  const count = limit(query.limit, budgets.retrieveCapabilities.maxCandidates, budgets.retrieveCapabilities.maxCandidates);
  if (!retriever) throw new CapabilityGraphError("CG_RETRIEVER_UNCONFIGURED", { nextAction: "configure_backend" });
  const raw = await invoke(() => retriever.retrieve({ text: query.text, providerIds: Object.freeze([...context.scope].sort()),
    staticRevisionByProvider: revisions(context), limit: count }));
  if (!raw || !Array.isArray(raw.candidates) || raw.candidates.length > count) contract("candidate_page_invalid");
  const items: CapabilityCandidate[] = []; const warnings: ResultMeta["warnings"][number][] = []; const seen = new Set<string>();
  for (const [index, candidate] of raw.candidates.entries()) {
    let node: StaticCapability;
    try {
      if (Buffer.byteLength(canonicalJson(candidate), "utf8") > budgets.retrieveCapabilities.maxCandidateBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      if (!candidate || (candidate.score !== undefined && (typeof candidate.score !== "number" || !Number.isFinite(candidate.score)))) contract("candidate_shape_invalid");
      node = await capability(context, candidate.id);
    } catch (error) {
      // A pinned source becoming unreadable invalidates the query; an offline unpinned source only rejects this candidate.
      if (!(error instanceof CapabilityGraphError) || error.code === "CG_REVISION_MISMATCH") throw error;
      warnings.push(warning(error.code, index)); continue;
    }
    try {
      // This mismatch belongs to the candidate, not to the requested authority view.
      if (candidate.sourceStaticRevision !== node.staticRevision) throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
      const key = formatQualifiedId(node.id);
      if (seen.has(key)) contract("duplicate_candidate"); seen.add(key);
      items.push({ id: node.id, qualifiedId: key, ...(candidate.score === undefined ? {} : { score: candidate.score }), rank: index + 1 });
    } catch (error) {
      if (!(error instanceof CapabilityGraphError)) throw error;
      warnings.push(warning(error.code, index));
    }
  }
  return { items, meta: { ...context.meta, warnings, completeness: warnings.length ? "partial" : "complete",
    budgets: { "retrieveCapabilities.maxCandidates": count, "retrieveCapabilities.maxCandidateBytes": budgets.retrieveCapabilities.maxCandidateBytes },
    view: { capabilities: items.map((entry) => ({ id: entry.id, staticRevision: context.graph.staticRevision(entry.id.providerId)! })) } } };
}
