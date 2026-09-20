import { createHash } from "node:crypto";
import type { BudgetConfig } from "../budgets.js";
import type { QueryContext } from "../core-host.js";
import { CapabilityGraphError, type ErrorShape } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { formatQualifiedId, isKnowledgeId } from "../identity.js";
import { locatorSource, readContext, readDocument, validateSelection } from "../knowledge/read.js";
import type { KnowledgeHit, KnowledgeIndexEvidence, KnowledgeReader, KnowledgeReadContext, KnowledgeRetriever, KnowledgeRetrievalAccess, KnowledgeSearchTarget } from "../knowledge/types.js";
import { bytes, capability, identity, inputInvalid, limit } from "../query/common.js";
import type { KnowledgeDocumentRef, ResultMeta, StaticCapability } from "../types.js";
import { freeze } from "../validate/values.js";
import { contract, invoke, queryText, warning } from "./common.js";
import type { QueryKnowledgePage, QueryKnowledgeQuery } from "./types.js";

const key = (target: Pick<KnowledgeSearchTarget, "id" | "knowledgeId">) => `${formatQualifiedId(target.id)}::${target.knowledgeId}`;
interface Allowed { target: KnowledgeSearchTarget; ref: KnowledgeDocumentRef; context: KnowledgeReadContext }
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const stale = (): never => { throw new CapabilityGraphError("CG_INDEX_STALE", { nextAction: "refresh" }); };

/** Project every nested field; internal read contexts never enter the transport request. */
export function projectKnowledgeTarget(target: KnowledgeSearchTarget): KnowledgeSearchTarget {
  return { id: { providerId: target.id.providerId, capabilityId: target.id.capabilityId }, knowledgeId: target.knowledgeId,
    locator: target.locator.type === "relative-file" ? { type: "relative-file", path: target.locator.path } : { type: "http", url: target.locator.url },
    viaCollectionIds: [...target.viaCollectionIds] };
}

/** Expand only selected knowledge, then verify index evidence and bounded hits against that boundary. */
export async function queryKnowledge(context: QueryContext, query: QueryKnowledgeQuery, budgets: BudgetConfig, readers: readonly KnowledgeReader[], retriever?: KnowledgeRetriever, bound?: string): Promise<QueryKnowledgePage> {
  queryText(query.text); validateSelection(query);
  if (query.knowledgeIds?.length === 0) inputInvalid();
  const count = limit(query.limit, budgets.queryKnowledge.maxHits, budgets.queryKnowledge.maxHits);
  const warnings: ResultMeta["warnings"][number][] = [];
  const failures: { inputIndex: number; code: ErrorShape["code"]; nextAction: ErrorShape["nextAction"] }[] = [];
  let failureCount = 0; let firstFailure: ErrorShape | undefined; let mixedFailures = false;
  const nodes: StaticCapability[] = []; const seenNodes = new Set<string>();
  for (const [index, ref] of query.selected.entries()) {
    try { const node = await capability(context, ref, bound); const id = formatQualifiedId(node.id);
      if (!seenNodes.has(id)) { seenNodes.add(id); nodes.push(node); } }
    catch (error) {
      if (!(error instanceof CapabilityGraphError) || error.code === "CG_REVISION_MISMATCH") throw error;
      firstFailure ??= { code: error.code, message: error.message, nextAction: error.nextAction };
      mixedFailures ||= firstFailure.code !== error.code;
      failureCount++;
      if (failures.length < 20) failures.push({ inputIndex: index, code: error.code, nextAction: error.nextAction });
      warnings.push({ code: error.code, message: "Selected capability could not be resolved.", details: { selectedIndex: index } });
    }
  }
  if (!nodes.length) throw new CapabilityGraphError(mixedFailures ? "CG_PARTIAL_ITEM" : firstFailure!.code, {
    nextAction: mixedFailures ? "fix_input" : firstFailure!.nextAction,
    details: { failureCount, failures, omittedFailureCount: failureCount - failures.length },
  });
  if (nodes.every((node) => !node.knowledge.length)) throw new CapabilityGraphError("CG_KNOWLEDGE_NOT_ASSOCIATED", { nextAction: "repair_source",
    details: { retrieval: retriever ? "configured" : "CG_RETRIEVER_UNCONFIGURED" } });
  const allowed = new Map<string, Allowed>(); const matched = new Set<string>();
  for (const node of nodes) {
    if (!node.knowledge.length) { warnings.push({ code: "CG_KNOWLEDGE_NOT_ASSOCIATED", message: "Selected capability has no associated knowledge.", details: { qualifiedId: formatQualifiedId(node.id) } }); continue; }
    const add = (ref: KnowledgeDocumentRef, via: string[]) => {
      const target = { id: node.id, knowledgeId: ref.knowledgeId, locator: ref.locator, viaCollectionIds: via };
      const targetKey = key(target); const previous = allowed.get(targetKey);
      allowed.set(targetKey, { target: { ...target, viaCollectionIds: [...new Set([...(previous?.target.viaCollectionIds ?? []), ...via])].sort() },
        ref, context: readContext(context, node.id.providerId) });
    };
    for (const reference of node.knowledge) {
      const selected = query.knowledgeIds === undefined || query.knowledgeIds.includes(reference.knowledgeId);
      if (selected) matched.add(reference.knowledgeId);
      if (reference.kind === "document") { if (selected) add(reference, []); }
      else for (const member of reference.members) {
        const selectMember = query.knowledgeIds?.includes(member.knowledgeId) ?? false;
        if (selectMember) matched.add(member.knowledgeId);
        if (selected || selectMember) add(member, [reference.knowledgeId]);
      }
    }
  }
  for (const id of query.knowledgeIds ?? []) if (!matched.has(id)) warnings.push({ code: "CG_NOT_FOUND", message: "Requested knowledge is not declared by any selected capability.", details: { knowledgeId: id } });
  if (!retriever) throw new CapabilityGraphError("CG_RETRIEVER_UNCONFIGURED", { nextAction: "configure_backend" });
  const meta = (): ResultMeta => ({ ...context.meta, warnings, completeness: warnings.length ? "partial" : "complete",
    budgets: { "queryKnowledge.maxHits": count, "queryKnowledge.maxSnippetBytes": budgets.queryKnowledge.maxSnippetBytes } });
  if (!allowed.size) return { items: [], knowledgeState: (query.knowledgeIds ?? []).some((id) => !matched.has(id)) ? "filtered_empty" : "empty_collection", meta: meta() };

  const entries = [...allowed.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  // Mapping identity changes with bindings/source roots, independently of document content identity.
  const mappingRevision = `m:${hash(entries.map(([, entry]) => ({ target: projectKnowledgeTarget(entry.target),
    contextDigest: hash({ providerId: entry.context.providerId, authorityKind: entry.context.sourceContext.authorityKind,
      knowledgeRootDir: entry.context.sourceContext.knowledgeRootDir ?? null }) })))}`;
  // Authorization scope is not an index dependency: only expanded, selected targets contribute revisions.
  const staticRevisionByProvider = Object.fromEntries(entries.map(([, entry]) => [entry.context.providerId, entry.context.staticRevision]));
  const request = freeze({ text: query.text, staticRevisionByProvider, mappingRevision,
    targets: entries.map(([, entry]) => projectKnowledgeTarget(entry.target)), limit: count });
  let active = true;
  const accessErrors = new WeakMap<object, CapabilityGraphError>();
  const pending = new Set<ReturnType<KnowledgeReader["read"]>>();
  const observed = new Map<string, Awaited<ReturnType<KnowledgeReader["read"]>>>();
  const access: KnowledgeRetrievalAccess = Object.freeze({ read: (target: Pick<KnowledgeSearchTarget, "id" | "knowledgeId">, budget: { maxBytes: number }) => {
    let relativePath: string | undefined;
    const task = (async () => {
      if (!active) contract("retrieval_access_expired");
      if (!target || !budget || !Number.isSafeInteger(budget.maxBytes) || budget.maxBytes <= 0 || !isKnowledgeId(target.knowledgeId)) inputInvalid();
      if (Object.keys(target).some((field) => !["id", "knowledgeId"].includes(field))) contract("retrieval_target_override");
      const id = identity(target.id);
      if (!context.scope.has(id.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
      const targetKey = key({ id, knowledgeId: target.knowledgeId });
      const entry = allowed.get(targetKey); if (!entry) contract("retrieval_target_not_selected");
      if (entry.ref.locator.type === "relative-file") relativePath = entry.ref.locator.path;
      const result = await readDocument(entry.ref, entry.context, Math.min(budget.maxBytes, budgets.read.maxBytes), readers);
      observed.set(targetKey, result); return { ...result, bytes: Uint8Array.from(result.bytes) };
    })().catch((error: unknown) => {
      if (error instanceof CapabilityGraphError) {
        // Snapshot before the adapter can mutate/rethrow the error. Only bounded Core diagnostics cross back out.
        const details: Record<string, unknown> = {};
        const reason = error.details?.reason;
        if (typeof reason === "string" && ["retrieval_access_expired", "retrieval_target_override", "retrieval_target_not_selected",
          "reader_result_invalid", "reader_content_identity_mismatch"].includes(reason)) details.reason = reason;
        if (relativePath !== undefined && error.details?.path === relativePath &&
            ["CG_PATH_TRAVERSAL", "CG_SOURCE_UNREADABLE"].includes(error.code)) details.path = relativePath;
        accessErrors.set(error, new CapabilityGraphError(error.code, { nextAction: error.nextAction,
          ...(Object.keys(details).length ? { details } : {}) }));
      }
      throw error;
    });
    pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); return task;
  } });
  let raw: Awaited<ReturnType<KnowledgeRetriever["retrieve"]>>;
  try { raw = await invoke(() => retriever.retrieve(request, access), accessErrors); }
  // Stop new reads immediately, but retain the query pin until already-started reads settle.
  finally { active = false; await Promise.allSettled([...pending]); }
  if (!raw || !Array.isArray(raw.hits) || raw.hits.length > count) contract("knowledge_page_invalid");
  const evidence = raw.evidence;
  // Even zero hits require evidence for every allowed document; empty output does not prove a fresh index.
  let evidenceIds: Map<string, KnowledgeIndexEvidence["documents"][number]>;
  try {
    if (!evidence || canonicalJson(evidence.staticRevisionByProvider) !== canonicalJson(staticRevisionByProvider)) {
      if (!evidence) stale();
      throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
    }
    if (evidence.mappingRevision !== mappingRevision || evidence.freshness !== "current" || typeof evidence.observedAt !== "string" || !Number.isFinite(Date.parse(evidence.observedAt)) ||
        Date.parse(evidence.observedAt) > Date.now() + 1000 || typeof evidence.sourceConfigRevision !== "string" || !evidence.sourceConfigRevision || evidence.sourceConfigRevision !== evidence.indexedConfigRevision ||
        !Array.isArray(evidence.documents) || evidence.documents.length !== allowed.size) stale();
    evidenceIds = new Map();
    for (const document of evidence.documents) {
      const id = key(document);
      if (!allowed.has(id) || evidenceIds.has(id) || typeof document.sourceContentId !== "string" || !/^k:[a-f0-9]{16}$/.test(document.sourceContentId) ||
          document.sourceContentId !== document.indexedContentId || (observed.has(id) && observed.get(id)!.contentId !== document.sourceContentId)) stale();
      evidenceIds.set(id, document);
    }
  } catch (error) {
    if (error instanceof CapabilityGraphError && error.code === "CG_REVISION_MISMATCH") throw error;
    stale();
  }
  const items: KnowledgeHit[] = [];
  for (const [index, hit] of raw.hits.entries()) {
    try {
      if (!hit || typeof hit.snippet !== "string") contract("knowledge_hit_invalid");
      if (Buffer.byteLength(hit.snippet, "utf8") > budgets.queryKnowledge.maxSnippetBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      const id = identity(hit.id);
      if (!context.scope.has(id.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
      const hitKey = key(hit); const entry = allowed.get(hitKey); const proof = evidenceIds!.get(hitKey);
      if (!entry || !proof || hit.contentId !== proof.indexedContentId || hit.source !== locatorSource(entry.ref) ||
          !Number.isSafeInteger(hit.startOffset) || !Number.isSafeInteger(hit.endOffset) || hit.startOffset < 0 || hit.endOffset < hit.startOffset ||
          hit.endOffset - hit.startOffset !== Buffer.byteLength(hit.snippet, "utf8") ||
          (hit.score !== undefined && (typeof hit.score !== "number" || !Number.isFinite(hit.score)))) contract("knowledge_hit_mismatch");
      const observedDocument = observed.get(hitKey);
      if (observedDocument && (hit.endOffset > observedDocument.bytes.length ||
          !Buffer.from(observedDocument.bytes.subarray(hit.startOffset, hit.endOffset)).equals(Buffer.from(hit.snippet)))) contract("knowledge_hit_content_mismatch");
      items.push({ id, knowledgeId: hit.knowledgeId, contentId: hit.contentId, source: hit.source,
        startOffset: hit.startOffset, endOffset: hit.endOffset, snippet: hit.snippet, ...(hit.score === undefined ? {} : { score: hit.score }) });
    } catch (error) { warnings.push(warning(error instanceof CapabilityGraphError ? error.code : "CG_ADAPTER_CONTRACT_INVALID", index)); }
  }
  return { items, knowledgeState: "searched", indexStatus: { mappingRevision, observedAt: evidence.observedAt, freshness: "current", validatedDocuments: allowed.size },
    meta: { ...meta(), view: { capabilities: nodes.map((node) => ({ id: node.id, staticRevision: node.staticRevision })),
      knowledge: items.map((hit) => ({ id: hit.id, knowledgeId: hit.knowledgeId, contentId: hit.contentId })) } } };
}
