import type { ResolvedBudgetConfig } from "../budgets.js";
import type { QueryContext } from "../core-host.js";
import { CapabilityGraphError } from "../errors.js";
import { isKnowledgeId } from "../identity.js";
import { capability, bytes, inputInvalid } from "../query/common.js";
import { decodeCursor, encodeCursor } from "../query/cursor.js";
import type { CapabilityRef } from "../query/types.js";
import type { CanonicalCapabilityId, KnowledgeDocumentRef, ResultMeta } from "../types.js";
import { contentId } from "./local-file-reader.js";
import { locatorSource, readContext } from "./read.js";
import { documentRange } from "./stream.js";
import type { KnowledgeReader } from "./types.js";

export interface DocumentBodyQuery {
  readonly capability: CapabilityRef; readonly knowledgeId: string;
  readonly startOffset?: number; readonly maxBytes?: number; readonly cursor?: string;
  readonly requiredStaticRevision?: string; readonly signal?: AbortSignal;
}
export interface SpecificationBodyQuery extends Omit<DocumentBodyQuery, "capability"> { readonly providerId: string }
export interface DocumentBodyPage {
  readonly id?: CanonicalCapabilityId; readonly providerId: string; readonly knowledgeId: string;
  /** Identity of the complete source, not this page. */
  readonly contentId: string; readonly pageContentId: string;
  readonly source: string; readonly contentType: string; readonly text: string; readonly byteLength: number;
  readonly startOffset: number; readonly endOffset: number; readonly totalBytes: number;
  /** True only when this result contains the entire document. */
  readonly complete: boolean; readonly hasMore: boolean; readonly nextCursor?: string; readonly meta: ResultMeta;
}

export function validateBodyQuery(query: Omit<DocumentBodyQuery, "capability">, budgets: ResolvedBudgetConfig) {
  if (!isKnowledgeId(query.knowledgeId) || (query.startOffset !== undefined && (!Number.isSafeInteger(query.startOffset) || query.startOffset < 0)) ||
      (query.cursor !== undefined && query.startOffset !== undefined) || (query.maxBytes !== undefined && (!Number.isSafeInteger(query.maxBytes) || query.maxBytes < 1)) ||
      (query.signal !== undefined && !(query.signal instanceof AbortSignal))) inputInvalid();
  if ((query.maxBytes ?? budgets.read.maxBytes) > budgets.read.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
}

async function page(context: QueryContext, ref: KnowledgeDocumentRef, providerId: string, query: Omit<DocumentBodyQuery, "capability">,
  budgets: ResolvedBudgetConfig, readers: readonly KnowledgeReader[], id?: CanonicalCapabilityId): Promise<DocumentBodyPage> {
  const binding = { kind: id ? "document-body" as const : "specification-body" as const,
    staticRevision: context.graph.getView(providerId)!.staticRevision,
    filter: { providerId, id: id ?? null, knowledgeId: query.knowledgeId, source: locatorSource(ref) } };
  const previous = decodeCursor(query.cursor, binding);
  let startOffset = query.startOffset ?? 0; let requiredContentId: string | undefined;
  if (previous) {
    try {
      const position = JSON.parse(previous.after) as { offset: number; contentId: string };
      if (!Number.isSafeInteger(position.offset) || position.offset < 0 || !/^k:[a-f0-9]{16}$/.test(position.contentId)) inputInvalid();
      startOffset = position.offset; requiredContentId = position.contentId;
    } catch { inputInvalid(); }
  }
  const result = await documentRange(ref, readContext(context, providerId), readers, { startOffset,
    maxBytes: query.maxBytes ?? budgets.read.maxBytes, fallbackMaxBytes: budgets.read.maxResponseBytes,
    preferBoundary: true, ...(query.signal ? { signal: query.signal } : {}) });
  if (requiredContentId && requiredContentId !== result.contentId) throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh", details: { reason: "document_content_changed" } });
  const hasMore = result.endOffset < result.totalBytes;
  const value: DocumentBodyPage = { ...(id ? { id } : {}), providerId, knowledgeId: ref.knowledgeId,
    contentId: result.contentId, pageContentId: contentId(result.bytes), source: result.source, contentType: result.contentType,
    text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.bytes), byteLength: result.bytes.length,
    startOffset, endOffset: result.endOffset, totalBytes: result.totalBytes,
    complete: startOffset === 0 && !hasMore, hasMore,
    ...(hasMore ? { nextCursor: encodeCursor(binding, JSON.stringify({ offset: result.endOffset, contentId: result.contentId })) } : {}),
    meta: { ...context.meta, completeness: startOffset === 0 && !hasMore ? "complete" : "partial",
      budgets: { "read.maxBytes": budgets.read.maxBytes, "read.maxResponseBytes": budgets.read.maxResponseBytes } } };
  if (bytes(value) > budgets.read.maxResponseBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return value;
}

export async function documentBody(context: QueryContext, query: DocumentBodyQuery, budgets: ResolvedBudgetConfig, readers: readonly KnowledgeReader[], bound?: string) {
  const node = await capability(context, query.capability, bound);
  const ref = node.knowledge.flatMap((item) => item.kind === "document" ? [item] : item.members).find((item) => item.knowledgeId === query.knowledgeId);
  if (!ref) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  return page(context, ref, node.id.providerId, query, budgets, readers, node.id);
}
export async function specificationBody(context: QueryContext, query: SpecificationBodyQuery, budgets: ResolvedBudgetConfig, readers: readonly KnowledgeReader[]) {
  if (!context.scope.has(query.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  await context.graph.getView(query.providerId)?.assertReadable?.();
  const ref = context.graph.getProvider(query.providerId)?.specification?.documents.find((item) => item.knowledgeId === query.knowledgeId);
  if (!ref) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  return page(context, ref, query.providerId, query, budgets, readers);
}
