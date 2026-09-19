import { CapabilityGraphError } from "../errors.js";
import type { CanonicalCapabilityId, NeighborKind } from "../types.js";
import type { StorePage, StorePageRequest, ValidatedProviderSnapshot, ValidatedProviderView } from "./types.js";

function paginate<T>(items: readonly T[], request: StorePageRequest): StorePage<T> {
  const start = request.cursor === undefined ? 0 : Number(request.cursor);
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length ||
      !Number.isSafeInteger(request.limit) || request.limit < 1 || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1) {
    throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
  }
  const result: T[] = [];
  let index = start;
  for (; index < items.length && result.length < request.limit; index++) {
    const next = [...result, items[index]!];
    if (Buffer.byteLength(JSON.stringify(next), "utf8") > request.maxBytes) {
      if (result.length === 0) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      break;
    }
    result.push(items[index]!);
  }
  return { items: result, ...(index < items.length ? { nextCursor: String(index) } : {}) };
}

/** File definitions stay in memory; reverse indexes never mutate the author's forward edges. */
export function memoryGraphStore(snapshot: ValidatedProviderSnapshot): ValidatedProviderView {
  const records = [...snapshot.capabilities.values()];
  const indexes = new Map<NeighborKind, Map<string, CanonicalCapabilityId[]>>();
  for (const kind of ["parents", "children", "specializes", "specializedBy", "related", "relatedBy"] as const) indexes.set(kind, new Map());
  for (const node of records) for (const [forward, reverse] of [["parents", "children"], ["specializes", "specializedBy"], ["related", "relatedBy"]] as const) {
    indexes.get(forward)!.set(node.id.capabilityId, [...new Map(node[forward].map((id) => [id.capabilityId, id])).values()]);
    for (const id of new Set(node[forward].map((id) => id.capabilityId))) {
      const back = indexes.get(reverse)!;
      back.set(id, [...(back.get(id) ?? []), node.id]);
    }
  }
  for (const groups of indexes.values()) for (const items of groups.values()) {
    items.sort((a, b) => a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0);
  }
  return { provider: snapshot.provider, staticRevision: snapshot.staticRevision, sourceContext: snapshot.sourceContext,
    getCapability: async (id) => snapshot.capabilities.get(id),
    listCapabilities: async (page) => paginate(records, page),
    neighbors: async (id, kind, page) => paginate(indexes.get(kind)?.get(id) ?? [], page),
    close: async () => {},
  };
}
