import type { BudgetConfig } from "../budgets.js";
import { errorShape, type QueryContext } from "../core-host.js";
import { CapabilityGraphError } from "../errors.js";
import { formatQualifiedId } from "../identity.js";
import type { BatchItem, BatchResult, NeighborKind, ResultMeta } from "../types.js";
import { bytes, capability, catalogRecord, identity, inputInvalid, KINDS, limit } from "./common.js";
import { decodeCursor, encodeCursor, position, walk, type CursorBinding, type Position } from "./cursor.js";
import type { CapabilityDetail, CapabilityDetailQuery, CapabilityRef, CatalogPage, CatalogQuery, CatalogRecord,
  DocumentPageQuery, KnowledgeMembersPage, KnowledgeMembersQuery, KnowledgeSummary, NeighborGroup, NeighborPage,
  NeighborQuery, NeighborSummaryGroup, ProviderResult, ProviderSummary, SpecificationDocumentsPage } from "./types.js";
import type { KnowledgeDocumentRef } from "../types.js";

export async function provider(context: QueryContext, id: string): Promise<ProviderSummary> {
  if (!context.scope.has(id)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  const data = context.graph.getProvider(id);
  if (!data) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  await context.graph.getView(id)!.assertReadable?.();
  const { specification, ...fields } = data;
  return { ...fields, ...(specification === undefined ? {} : { specification: {
    specificationId: specification.specificationId, version: specification.version,
    ...(specification.appliesTo === undefined ? {} : { appliesTo: specification.appliesTo }),
    documentCount: specification.documents.length } }), staticRevision: context.graph.staticRevision(id)! };
}

function documentPage(documents: readonly KnowledgeDocumentRef[], query: DocumentPageQuery,
  binding: CursorBinding, pageSize: number, maxPageSize: number, maxItemBytes: number, maxBytes: number,
  wrap: (page: { items: readonly KnowledgeDocumentRef[]; completeness: "complete" | "truncated"; nextCursor?: string }) => unknown) {
  const count = limit(query.limit, pageSize, maxPageSize);
  const bound = { ...binding, filter: { ...binding.filter as object, limit: count } };
  const cursor = decodeCursor(query.cursor, bound);
  const ordered = [...documents].sort((a, b) => a.knowledgeId < b.knowledgeId ? -1 : a.knowledgeId > b.knowledgeId ? 1 : 0);
  const start = cursor === undefined ? 0 : ordered.findIndex((item) => item.knowledgeId === cursor.after) + 1;
  if (cursor && start === 0) inputInvalid();
  const pageFor = (items: readonly KnowledgeDocumentRef[]) => {
    const nextCursor = start + items.length < ordered.length && items.length ? encodeCursor(bound, items.at(-1)!.knowledgeId) : undefined;
    return { items, completeness: nextCursor ? "truncated" as const : "complete" as const,
      ...(nextCursor === undefined ? {} : { nextCursor }) };
  };
  const items: KnowledgeDocumentRef[] = [];
  for (const item of ordered.slice(start, start + count)) {
    if (bytes(item) > maxItemBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
    const candidate = pageFor([...items, item]);
    if (bytes(wrap(candidate)) > maxBytes) {
      if (!items.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      break;
    }
    items.push(item);
  }
  const page = pageFor(items);
  if (bytes(wrap(page)) > maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return page;
}

export async function providerResult(context: QueryContext, id: string, budgets: BudgetConfig): Promise<ProviderResult> {
  const summary = await provider(context, id);
  const specification = context.graph.getProvider(id)!.specification;
  const result: ProviderResult = { ...summary, ...(specification === undefined ? {} : { specificationDocuments: documentPage(
    specification.documents, {}, { kind: "specification-documents", staticRevision: context.graph.staticRevision(id)!, filter: { providerId: id } },
    budgets.specification.defaultPageSize, budgets.specification.maxPageSize, budgets.specification.maxItemBytes, budgets.specification.maxBytes,
    (page) => ({ ...summary, specificationDocuments: page, meta: context.meta })) }), meta: context.meta };
  if (bytes(result) > budgets.specification.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return result;
}

export async function specificationDocuments(context: QueryContext, id: string, query: DocumentPageQuery,
  budgets: BudgetConfig): Promise<SpecificationDocumentsPage> {
  await provider(context, id);
  const documents = context.graph.getProvider(id)!.specification?.documents ?? [];
  const page = documentPage(documents, query,
    { kind: "specification-documents", staticRevision: context.graph.staticRevision(id)!, filter: { providerId: id } },
    budgets.specification.defaultPageSize, budgets.specification.maxPageSize, budgets.specification.maxItemBytes, budgets.specification.maxBytes,
    (page) => ({ providerId: id, ...page, meta: { ...context.meta, completeness: page.completeness,
      budgets: { "specification.maxBytes": budgets.specification.maxBytes, "specification.maxItemBytes": budgets.specification.maxItemBytes } } }));
  const result: SpecificationDocumentsPage = { providerId: id, ...page, meta: { ...context.meta, completeness: page.completeness,
    budgets: { "specification.maxBytes": budgets.specification.maxBytes, "specification.maxItemBytes": budgets.specification.maxItemBytes } } };
  if (bytes(result) > budgets.specification.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return result;
}

export async function knowledgeMembers(context: QueryContext, query: KnowledgeMembersQuery, budgets: BudgetConfig,
  bound?: string): Promise<KnowledgeMembersPage> {
  const node = await capability(context, query.capability, bound);
  const collection = node.knowledge.find((ref) => ref.knowledgeId === query.collectionId);
  if (!collection) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  if (collection.kind !== "collection") throw new CapabilityGraphError("CG_KNOWLEDGE_TYPE_UNSUPPORTED", { nextAction: "fix_input" });
  const page = documentPage(collection.members, query,
    { kind: "knowledge-members", staticRevision: node.staticRevision,
      filter: { id: node.id, collectionId: collection.knowledgeId } },
    budgets.detail.defaultKnowledgePageSize, budgets.detail.maxKnowledgePageSize, budgets.detail.maxItemBytes, budgets.detail.maxBytes,
    (page) => ({ id: node.id, collectionId: collection.knowledgeId, ...page,
      meta: { ...context.meta, completeness: page.completeness, budgets: { "detail.maxBytes": budgets.detail.maxBytes,
        "detail.maxItemBytes": budgets.detail.maxItemBytes }, view: { capabilities: [{ id: node.id, staticRevision: node.staticRevision }] } } }));
  const result: KnowledgeMembersPage = { id: node.id, collectionId: collection.knowledgeId, ...page,
    meta: { ...context.meta, completeness: page.completeness, budgets: { "detail.maxBytes": budgets.detail.maxBytes,
      "detail.maxItemBytes": budgets.detail.maxItemBytes }, view: { capabilities: [{ id: node.id, staticRevision: node.staticRevision }] } } };
  if (bytes(result) > budgets.detail.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return result;
}

export async function catalog(context: QueryContext, query: CatalogQuery, budgets: BudgetConfig, bound?: string): Promise<CatalogPage> {
  const count = limit(query.limit, budgets.catalog.maxItems, budgets.catalog.maxItems);
  if (query.capabilityIdPrefix !== undefined && typeof query.capabilityIdPrefix !== "string") inputInvalid();
  const parent = query.parent === undefined ? undefined : (await capability(context, query.parent, bound)).id;
  const filter = { scope: [...context.scope].sort(), prefix: query.capabilityIdPrefix ?? null, parent: parent ?? null, limit: count };
  const binding: CursorBinding = { kind: "catalog", staticRevision: context.meta.compositeStaticRevision, filter };
  const cursor = decodeCursor(query.cursor, binding);
  const ids = [...context.scope].sort();
  let start = 0; let offset: Position = { offset: 0 };
  if (cursor) {
    let parsed: { providerId: string; position: string };
    try { parsed = JSON.parse(cursor.after) as typeof parsed; } catch { inputInvalid(); }
    if (!parsed || !ids.includes(parsed.providerId) || typeof parsed.position !== "string") inputInvalid();
    start = ids.indexOf(parsed.providerId); offset = position(parsed.position);
  }
  const items: CatalogRecord[] = [];
  const warnings: ResultMeta["warnings"][number][] = [];
  const meta = (truncated: boolean): ResultMeta => ({ ...context.meta, filter, warnings,
    completeness: warnings.length ? "partial" : truncated ? "truncated" : "complete", budgets: {
      "catalog.maxBytes": budgets.catalog.maxBytes, "catalog.maxItems": budgets.catalog.maxItems, "catalog.maxItemBytes": budgets.catalog.maxItemBytes } });
  const finish = (nextCursor?: string): CatalogPage => {
    const result = { items, meta: meta(nextCursor !== undefined), ...(nextCursor === undefined ? {} : { nextCursor }) };
    if (bytes(result) > budgets.catalog.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
    return result;
  };
  for (let i = start; i < ids.length; i++) {
    const id = ids[i]!; const view = context.graph.getView(id);
    if (!view) continue;
    for await (const row of walk((page) => view.listCapabilities(page), i === start ? offset : undefined)) {
      const node = row.item;
      if (query.capabilityIdPrefix !== undefined && !node.id.capabilityId.startsWith(query.capabilityIdPrefix)) continue;
      if (parent && !node.parents.some((target) => target.providerId === parent.providerId && target.capabilityId === parent.capabilityId)) continue;
      const before = encodeCursor(binding, JSON.stringify({ providerId: id, position: JSON.stringify(row.before) }));
      if (items.length + warnings.length >= count) return finish(before);
      const item = catalogRecord(node);
      if (bytes(item) > budgets.catalog.maxItemBytes) {
        warnings.push({ code: "CG_BUDGET_EXCEEDED", message: "Catalog row omitted because it exceeds maxItemBytes.", details: { qualifiedId: item.qualifiedId } });
        if (bytes({ items, meta: meta(true), nextCursor: before }) > budgets.catalog.maxBytes) {
          warnings.pop();
          if (!items.length && !warnings.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
          return finish(before);
        }
        continue;
      }
      if (bytes({ items: [...items, item], meta: meta(true), nextCursor: before }) > budgets.catalog.maxBytes) {
        if (!items.length && !warnings.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
        return finish(before);
      }
      items.push(item);
    }
  }
  return finish();
}

export async function neighbors(context: QueryContext, ref: CapabilityRef, query: NeighborQuery, budgets: BudgetConfig, bound?: string): Promise<NeighborPage> {
  const node = await capability(context, ref, bound);
  const count = limit(query.limitPerKind, budgets.neighbors.defaultPageSize, budgets.neighbors.maxPageSize);
  const kinds = query.kinds ?? KINDS;
  if (!Array.isArray(kinds) || kinds.some((kind) => !KINDS.includes(kind)) || new Set(kinds).size !== kinds.length) inputInvalid();
  if (query.cursors && Object.keys(query.cursors).some((kind) => !KINDS.includes(kind as NeighborKind) || !kinds.includes(kind as NeighborKind))) inputInvalid();
  const groups = {} as Record<NeighborKind, NeighborGroup>;
  const warnings: ResultMeta["warnings"][number][] = [];
  const result = (): NeighborPage => ({ id: node.id, groups, meta: { ...context.meta, filter: { kinds }, warnings,
    completeness: warnings.length ? "partial" : KINDS.some((kind) => groups[kind].nextCursor) ? "truncated" : "complete",
    budgets: { "neighbors.maxPageSize": budgets.neighbors.maxPageSize, "neighbors.maxBytes": budgets.neighbors.maxBytes,
      "neighbors.maxItemBytes": budgets.neighbors.maxItemBytes },
    view: { capabilities: [{ id: node.id, staticRevision: node.staticRevision }] } } });
  const overflow = (): never => { throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" }); };
  const streams = [];
  for (const kind of KINDS) {
    groups[kind] = { items: [], completeness: "complete" };
    if (kinds.includes(kind)) {
      const binding: CursorBinding = { kind: "neighbors", staticRevision: context.meta.compositeStaticRevision, filter: { id: node.id, kind, limit: count } };
      const cursor = decodeCursor(query.cursors?.[kind], binding);
      const iterator = walk((page) => context.graph.getView(node.id.providerId)!.neighbors(node.id.capabilityId, kind, page), position(cursor?.after));
      const next = await iterator.next();
      if (!next.done) {
        groups[kind] = { items: [], completeness: "truncated", nextCursor: encodeCursor(binding, JSON.stringify(next.value.before)) };
        streams.push({ kind, binding, iterator, next });
      }
    }
  }
  // Reserve real continuation positions for every group before spending the shared byte budget.
  if (bytes(result()) > budgets.neighbors.maxBytes) overflow();
  let consumed = 0;
  for (const { kind, binding, iterator, next: first } of streams) {
    let next: Awaited<ReturnType<typeof iterator.next>> = first;
    for (let used = 0; !next.done && used < count; used++) {
      const previous = groups[kind];
      const item = catalogRecord(await capability(context, next.value.item));
      const omitted = bytes(item) > budgets.neighbors.maxItemBytes;
      if (omitted) warnings.push({ code: "CG_BUDGET_EXCEEDED", message: "Neighbor row omitted because it exceeds maxItemBytes.",
        details: { kind, qualifiedId: item.qualifiedId } });
      next = await iterator.next();
      const nextCursor = next.done ? undefined : encodeCursor(binding, JSON.stringify(next.value.before));
      groups[kind] = { items: omitted ? previous.items : [...previous.items, item],
        completeness: omitted || previous.completeness === "partial" ? "partial" : nextCursor ? "truncated" : "complete",
        ...(nextCursor === undefined ? {} : { nextCursor }) };
      if (bytes(result()) > budgets.neighbors.maxBytes) {
        groups[kind] = previous;
        if (omitted) warnings.pop();
        break;
      }
      consumed++;
    }
  }
  if (streams.length && !consumed) overflow();
  return result();
}

export async function details(context: QueryContext, refs: readonly CapabilityRef[], query: CapabilityDetailQuery, budgets: BudgetConfig, bound?: string): Promise<BatchResult<CapabilityDetail>> {
  if (!Array.isArray(refs)) inputInvalid();
  if (refs.length > budgets.detail.maxCapabilities) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  const neighborLimit = limit(query.neighborLimitPerKind, budgets.neighbors.defaultPageSize, budgets.neighbors.maxPageSize, true);
  const knowledgeLimit = limit(query.knowledgeLimit, budgets.detail.defaultKnowledgePageSize, budgets.detail.maxKnowledgePageSize);
  const results: BatchItem<CapabilityDetail>[] = [];
  let truncated = false;
  for (const [inputIndex, ref] of refs.entries()) {
    try {
      const node = await capability(context, ref, bound);
      const qualifiedId = formatQualifiedId(node.id);
      const binding: CursorBinding = { kind: "detail-knowledge", staticRevision: context.meta.compositeStaticRevision, filter: { id: node.id, limit: knowledgeLimit } };
      const cursor = decodeCursor(query.knowledgeCursors?.[qualifiedId], binding);
      const all = [...node.knowledge].sort((a, b) => a.knowledgeId < b.knowledgeId ? -1 : a.knowledgeId > b.knowledgeId ? 1 : 0);
      if (cursor && !all.some((entry) => entry.knowledgeId === cursor.after)) inputInvalid();
      const remaining = cursor ? all.filter((entry) => entry.knowledgeId > cursor.after) : all;
      const selected = remaining.slice(0, knowledgeLimit);
      const knowledgeItems: KnowledgeSummary[] = selected.map((entry) => entry.kind === "document" ? entry :
        { kind: "collection", knowledgeId: entry.knowledgeId, ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.summary === undefined ? {} : { summary: entry.summary }), memberCount: entry.members.length });
      const nextCursor = remaining.length > selected.length ? encodeCursor(binding, selected.at(-1)!.knowledgeId) : undefined;
      const neighborSummaries = {} as Record<NeighborKind, NeighborSummaryGroup>;
      for (const kind of KINDS) {
        const items: { id: typeof node.id; name: string }[] = []; let more = false;
        for await (const row of walk((page) => context.graph.getView(node.id.providerId)!.neighbors(node.id.capabilityId, kind, page))) {
          if (items.length >= neighborLimit) { more = true; break; }
          const target = await capability(context, row.item); items.push({ id: target.id, name: target.name });
        }
        neighborSummaries[kind] = { items, completeness: more ? "truncated" : "complete" };
      }
      const value: CapabilityDetail = { id: node.id, qualifiedId, name: node.name, description: node.description,
        whenToUse: node.whenToUse, ...(node.distinction === undefined ? {} : { distinction: node.distinction }),
        staticRevision: node.staticRevision, examples: node.examples, neighborSummaries,
        knowledge: { items: knowledgeItems, completeness: nextCursor ? "truncated" : "complete", ...(nextCursor ? { nextCursor } : {}) } };
      if (bytes(value) > budgets.detail.maxItemBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      results.push({ inputIndex, ok: true, value });
      if (nextCursor || KINDS.some((kind) => neighborSummaries[kind].completeness === "truncated")) truncated = true;
    } catch (error) {
      if (!(error instanceof CapabilityGraphError)) throw error;
      if (error.code === "CG_REVISION_MISMATCH") throw error;
      results.push({ inputIndex, ok: false, error: errorShape(error) });
    }
  }
  const result: BatchResult<CapabilityDetail> = { results, meta: { ...context.meta,
    completeness: results.some((entry) => !entry.ok) ? "partial" : truncated ? "truncated" : "complete",
    budgets: { "detail.maxItemBytes": budgets.detail.maxItemBytes, "detail.maxBytes": budgets.detail.maxBytes },
    view: { capabilities: results.flatMap((entry) => entry.ok ? [{ id: entry.value.id, staticRevision: entry.value.staticRevision }] : []) } } };
  if (bytes(result) > budgets.detail.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return result;
}

export function refScope(refs: readonly CapabilityRef[], bound?: string): string[] | undefined {
  if (bound) return [bound];
  if (!Array.isArray(refs)) inputInvalid();
  const ids = new Set<string>();
  for (const ref of refs) { try { ids.add(identity(ref).providerId); } catch { /* Invalid identities keep their batch slots. */ } }
  return ids.size === 1 ? [...ids] : undefined;
}
