import type { BudgetConfig } from "../budgets.js";
import { errorShape, type QueryContext } from "../core-host.js";
import { CapabilityGraphError, type ErrorShape } from "../errors.js";
import { formatQualifiedId, isKnowledgeId } from "../identity.js";
import { normalizeLocale } from "../locale.js";
import { capability, inputInvalid } from "../query/common.js";
import type { CapabilityRef } from "../query/types.js";
import type { BatchItem, BatchResult, CanonicalCapabilityId, KnowledgeDocumentRef, KnowledgeRef, StaticCapability } from "../types.js";
import { freeze } from "../validate/values.js";
import { contentId, LocalFileReader } from "./local-file-reader.js";
import type { KnowledgeReadContext, KnowledgeReader, KnowledgeRetriever } from "./types.js";

/** Explicit nonempty selection. No relation traversal; Collection bodies are not concatenated for direct reading. */
export interface ReadDocumentsQuery {
  readonly selected: readonly CapabilityRef[]; readonly knowledgeIds?: readonly string[];
  readonly roles?: readonly string[]; readonly locales?: readonly string[];
  readonly requestProviderScope?: readonly string[]; readonly requiredStaticRevision?: string;
}
export interface DocumentRead {
  readonly id: CanonicalCapabilityId; readonly knowledgeId: string; readonly contentId: string;
  readonly source: string; readonly contentType: string; readonly text: string; readonly byteLength: number;
  readonly role: string; readonly locale?: string; readonly title?: string; readonly summary?: string; readonly canonicalUrl?: string;
}
export type DocumentReadBatch = BatchResult<DocumentRead> & { readonly knowledgeState: "not_associated" | "filtered_empty" | "matched" };
export type SpecificationDocumentRead = Omit<DocumentRead, "id"> & { readonly providerId: string };
export type SpecificationReadBatch = BatchResult<SpecificationDocumentRead> & {
  readonly knowledgeState: "not_associated" | "filtered_empty" | "matched";
};
export interface ReadSpecificationQuery {
  readonly providerId: string; readonly knowledgeIds?: readonly string[]; readonly locales?: readonly string[];
  readonly requiredStaticRevision?: string;
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
  validateDocumentFilters(query);
}

export function validateDocumentFilters(query: { readonly knowledgeIds?: readonly string[]; readonly roles?: readonly string[]; readonly locales?: readonly string[] }):
  { readonly roles?: ReadonlySet<string>; readonly locales?: ReadonlySet<string> } {
  if (query.knowledgeIds !== undefined && (!Array.isArray(query.knowledgeIds) || query.knowledgeIds.some((id) => !isKnowledgeId(id)))) inputInvalid();
  if (query.roles !== undefined && (!Array.isArray(query.roles) || query.roles.some((role) => !isKnowledgeId(role)))) inputInvalid();
  if (query.locales !== undefined && !Array.isArray(query.locales)) inputInvalid();
  let locales: Set<string> | undefined;
  if (query.locales !== undefined) {
    try { locales = new Set(query.locales.map(normalizeLocale)); }
    catch { inputInvalid(); }
  }
  return { ...(query.roles === undefined ? {} : { roles: new Set(query.roles) }), ...(locales === undefined ? {} : { locales }) };
}

function matches(ref: KnowledgeDocumentRef, filters: ReturnType<typeof validateDocumentFilters>): boolean {
  return (filters.roles === undefined || filters.roles.has(ref.role)) &&
    (filters.locales === undefined || (ref.locale !== undefined && filters.locales.has(ref.locale)));
}

async function readValue(ref: KnowledgeDocumentRef, providerId: string, context: QueryContext,
  budgets: BudgetConfig, readers: readonly KnowledgeReader[]): Promise<Omit<DocumentRead, "id">> {
  const read = await readDocument(ref, readContext(context, providerId), budgets.read.maxBytes, readers);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes); }
  catch { throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { reason: "invalid_utf8" } }); }
  return { knowledgeId: ref.knowledgeId, contentId: read.contentId, source: read.source,
    contentType: read.contentType, text, byteLength: read.bytes.length, role: ref.role,
    ...(ref.locale === undefined ? {} : { locale: ref.locale }), ...(ref.title === undefined ? {} : { title: ref.title }),
    ...(ref.summary === undefined ? {} : { summary: ref.summary }),
    ...(ref.canonicalUrl === undefined ? {} : { canonicalUrl: ref.canonicalUrl }) };
}

async function readSlot(ref: KnowledgeDocumentRef, id: CanonicalCapabilityId, context: QueryContext,
  budgets: BudgetConfig, readers: readonly KnowledgeReader[]): Promise<DocumentRead> {
  return { id, ...await readValue(ref, id.providerId, context, budgets, readers) };
}

export async function documents(context: QueryContext, query: ReadDocumentsQuery, budgets: BudgetConfig, readers: readonly KnowledgeReader[], retriever?: KnowledgeRetriever, bound?: string): Promise<DocumentReadBatch> {
  validateSelection(query);
  const filters = validateDocumentFilters(query);
  const slots: ({ node: StaticCapability; ref: KnowledgeDocumentRef } | { error: ErrorShape })[] = [];
  const declared = new Set<string>();
  const collections = new Set<string>();
  const seen = new Set<string>();
  const selectedIds = query.knowledgeIds === undefined ? undefined : new Set(query.knowledgeIds);
  let associated = false;
  for (const selected of query.selected) {
    let node: StaticCapability;
    try { node = await capability(context, selected, bound); }
    catch (error) {
      if (!(error instanceof CapabilityGraphError) || error.code === "CG_REVISION_MISMATCH") throw error;
      slots.push({ error: errorShape(error) }); continue;
    }
    associated ||= node.knowledge.length > 0;
    if (selectedIds === undefined && !node.knowledge.length) {
      slots.push({ error: errorShape(new CapabilityGraphError("CG_KNOWLEDGE_NOT_ASSOCIATED", { nextAction: "repair_source" })) });
    }
    const add = (ref: KnowledgeDocumentRef, explicit: boolean) => {
      declared.add(ref.knowledgeId);
      if ((!selectedIds && !explicit) || (selectedIds && !selectedIds.has(ref.knowledgeId)) || !matches(ref, filters)) return;
      const key = `${formatQualifiedId(node.id)}::${ref.knowledgeId}`;
      if (!seen.has(key)) { seen.add(key); slots.push({ node, ref }); }
    };
    for (const ref of node.knowledge) {
      if (ref.kind === "document") add(ref, true);
      else {
        declared.add(ref.knowledgeId); collections.add(ref.knowledgeId);
        for (const member of ref.members) add(member, false);
      }
    }
  }
  for (const id of selectedIds ?? []) {
    if (collections.has(id)) slots.push({ error: errorShape(new CapabilityGraphError("CG_KNOWLEDGE_TYPE_UNSUPPORTED", {
      nextAction: "fix_input", details: { knowledgeId: id, retrieval: retriever ? "configured" : "CG_RETRIEVER_UNCONFIGURED" } })) });
    else if (!declared.has(id)) slots.push({ error: errorShape(new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input", details: { knowledgeId: id } })) });
  }
  const readCount = slots.filter((slot) => "node" in slot).length;
  if (readCount > budgets.read.maxDocumentsPerCall) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  const results: BatchItem<DocumentRead>[] = [];
  for (const [inputIndex, slot] of slots.entries()) {
    if ("error" in slot) { results.push({ inputIndex, ok: false, error: slot.error }); continue; }
    try {
      results.push({ inputIndex, ok: true, value: await readSlot(slot.ref, slot.node.id, context, budgets, readers) });
    } catch (error) { results.push({ inputIndex, ok: false, error: errorShape(error) }); }
  }
  return { results, knowledgeState: !associated ? "not_associated" : readCount ? "matched" : "filtered_empty",
    meta: { ...context.meta, completeness: results.some((slot) => !slot.ok) ? "partial" : "complete",
    budgets: { "read.maxBytes": budgets.read.maxBytes, "read.maxDocumentsPerCall": budgets.read.maxDocumentsPerCall },
    view: { capabilities: slots.flatMap((slot) => "node" in slot ? [{ id: slot.node.id, staticRevision: slot.node.staticRevision }] : []),
      knowledge: results.flatMap((slot) => slot.ok ? [{ id: slot.value.id, knowledgeId: slot.value.knowledgeId, contentId: slot.value.contentId }] : []) } } };
}

export async function readSpecification(context: QueryContext, query: ReadSpecificationQuery,
  budgets: BudgetConfig, readers: readonly KnowledgeReader[]): Promise<SpecificationReadBatch> {
  const filters = validateDocumentFilters(query);
  if (!context.scope.has(query.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  const provider = context.graph.getProvider(query.providerId);
  if (!provider) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  await context.graph.getView(query.providerId)!.assertReadable?.();
  const available = provider.specification?.documents ?? [];
  const known = new Set(available.map((doc) => doc.knowledgeId));
  const selected = query.knowledgeIds === undefined ? available : available.filter((doc) => query.knowledgeIds!.includes(doc.knowledgeId));
  const docs = selected.filter((doc) => matches(doc, filters));
  if (docs.length > budgets.read.maxDocumentsPerCall) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  const results: BatchItem<SpecificationDocumentRead>[] = [];
  for (const ref of docs) {
    const inputIndex = results.length;
    try { results.push({ inputIndex, ok: true, value: { providerId: query.providerId,
      ...await readValue(ref, query.providerId, context, budgets, readers) } }); }
    catch (error) { results.push({ inputIndex, ok: false, error: errorShape(error) }); }
  }
  for (const knowledgeId of new Set(query.knowledgeIds ?? [])) if (!known.has(knowledgeId)) {
    results.push({ inputIndex: results.length, ok: false, error: errorShape(new CapabilityGraphError("CG_NOT_FOUND", {
      nextAction: "fix_input", details: { knowledgeId } })) });
  }
  return { results, knowledgeState: !provider.specification ? "not_associated" : docs.length ? "matched" : "filtered_empty",
    meta: { ...context.meta, completeness: results.some((item) => !item.ok) ? "partial" : "complete",
      budgets: { "read.maxBytes": budgets.read.maxBytes, "read.maxDocumentsPerCall": budgets.read.maxDocumentsPerCall } } };
}
