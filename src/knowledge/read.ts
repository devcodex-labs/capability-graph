import type { BudgetConfig } from "../budgets.js";
import { errorShape, type QueryContext } from "../core-host.js";
import { CapabilityGraphError, type ErrorShape } from "../errors.js";
import { isKnowledgeId } from "../identity.js";
import { capability, inputInvalid } from "../query/common.js";
import type { CapabilityRef } from "../query/types.js";
import type { BatchItem, BatchResult, CanonicalCapabilityId, KnowledgeDocumentRef, KnowledgeRef, StaticCapability } from "../types.js";
import { freeze } from "../validate/values.js";
import { contentId, LocalFileReader } from "./local-file-reader.js";
import type { KnowledgeReadContext, KnowledgeReader, KnowledgeRetriever } from "./types.js";

/** Explicit nonempty selection. No relation traversal; Collection bodies are not concatenated for direct reading. */
export interface ReadDocumentsQuery {
  readonly selected: readonly CapabilityRef[]; readonly knowledgeIds?: readonly string[];
  readonly requestProviderScope?: readonly string[]; readonly requiredStaticRevision?: string;
}
export interface DocumentRead {
  readonly id: CanonicalCapabilityId; readonly knowledgeId: string; readonly contentId: string;
  readonly source: string; readonly contentType: string; readonly text: string; readonly byteLength: number;
}
export const locatorSource = (ref: KnowledgeDocumentRef): string => ref.locator.type === "relative-file" ? ref.locator.path : ref.locator.url;
export function readContext(context: QueryContext, providerId: string): KnowledgeReadContext {
  const view = context.graph.getView(providerId)!;
  return freeze({ providerId, staticRevision: view.staticRevision, sourceContext: { ...view.sourceContext } });
}
/** Local-reader priority cannot be overridden; custom results are bounded, copied and content-hash checked before exposure. */
export async function readDocument(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, maxBytes: number, readers: readonly KnowledgeReader[]): ReturnType<KnowledgeReader["read"]> {
  const local = new LocalFileReader();
  let reader: KnowledgeReader | undefined;
  try { reader = local.canRead(ref) ? local : readers.find((candidate) => candidate.canRead(ref)); }
  catch { throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" }); }
  if (!reader) throw new CapabilityGraphError("CG_READER_UNCONFIGURED", { nextAction: "configure_backend" });
  let raw: Awaited<ReturnType<KnowledgeReader["read"]>>;
  try { raw = await reader.read(ref, context, { maxBytes }); }
  catch (error) {
    if (reader === local && error instanceof CapabilityGraphError) throw error;
    throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" });
  }
  if (!raw || !(raw.bytes instanceof Uint8Array) || typeof raw.contentType !== "string" || !raw.contentType.trim() || raw.source !== locatorSource(ref)) {
    throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason: "reader_result_invalid" } });
  }
  if (raw.bytes.byteLength > maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "reduce_document" });
  const bytes = Uint8Array.from(raw.bytes);
  const computed = contentId(bytes);
  if (computed !== raw.contentId) throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason: "reader_content_identity_mismatch" } });
  return { bytes, contentId: computed, contentType: raw.contentType, source: locatorSource(ref) };
}

export function validateSelection(query: ReadDocumentsQuery): void {
  if (!query || !Array.isArray(query.selected) || !query.selected.length) {
    throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "select_capabilities" });
  }
  if (query.knowledgeIds !== undefined && (!Array.isArray(query.knowledgeIds) || query.knowledgeIds.some((id) => !isKnowledgeId(id)))) inputInvalid();
}

export async function documents(context: QueryContext, query: ReadDocumentsQuery, budgets: BudgetConfig, readers: readonly KnowledgeReader[], retriever?: KnowledgeRetriever, bound?: string): Promise<BatchResult<DocumentRead>> {
  validateSelection(query);
  const slots: ({ node: StaticCapability; ref: KnowledgeRef } | { error: ErrorShape })[] = [];
  const matched = new Set<string>();
  for (const selected of query.selected) {
    let node: StaticCapability;
    try { node = await capability(context, selected, bound); }
    catch (error) {
      if (!(error instanceof CapabilityGraphError) || error.code === "CG_REVISION_MISMATCH") throw error;
      slots.push({ error: errorShape(error) }); continue;
    }
    if (query.knowledgeIds === undefined && !node.knowledge.length) {
      slots.push({ error: errorShape(new CapabilityGraphError("CG_KNOWLEDGE_NOT_ASSOCIATED", { nextAction: "repair_source" })) });
    }
    for (const ref of node.knowledge) if (query.knowledgeIds === undefined || query.knowledgeIds.includes(ref.knowledgeId)) {
      matched.add(ref.knowledgeId); slots.push({ node, ref });
    }
  }
  for (const id of query.knowledgeIds ?? []) if (!matched.has(id)) slots.push({ error: errorShape(new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input", details: { knowledgeId: id } })) });
  if (slots.length > budgets.read.maxDocumentsPerCall) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  const results: BatchItem<DocumentRead>[] = [];
  for (const [inputIndex, slot] of slots.entries()) {
    if ("error" in slot) { results.push({ inputIndex, ok: false, error: slot.error }); continue; }
    try {
      if (slot.ref.kind === "collection") throw new CapabilityGraphError("CG_KNOWLEDGE_TYPE_UNSUPPORTED", { nextAction: "use_retrieval", details: {
        retrieval: retriever ? { code: "configured", nextAction: "use_retrieval" } : { code: "CG_RETRIEVER_UNCONFIGURED", nextAction: "configure_backend" },
      } });
      const read = await readDocument(slot.ref, readContext(context, slot.node.id.providerId), budgets.read.maxBytes, readers);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes); }
      catch { throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { reason: "invalid_utf8" } }); }
      results.push({ inputIndex, ok: true, value: { id: slot.node.id, knowledgeId: slot.ref.knowledgeId,
        contentId: read.contentId, source: read.source, contentType: read.contentType, text, byteLength: read.bytes.length } });
    } catch (error) { results.push({ inputIndex, ok: false, error: errorShape(error) }); }
  }
  return { results, meta: { ...context.meta, completeness: results.some((slot) => !slot.ok) ? "partial" : "complete",
    budgets: { "read.maxBytes": budgets.read.maxBytes, "read.maxDocumentsPerCall": budgets.read.maxDocumentsPerCall },
    view: { capabilities: slots.flatMap((slot) => "node" in slot ? [{ id: slot.node.id, staticRevision: slot.node.staticRevision }] : []),
      knowledge: results.flatMap((slot) => slot.ok ? [{ id: slot.value.id, knowledgeId: slot.value.knowledgeId, contentId: slot.value.contentId }] : []) } } };
}
