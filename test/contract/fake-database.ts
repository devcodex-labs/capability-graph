import type { DatabaseReadView, StorePage, StorePageRequest, UnvalidatedCapabilityRecord } from "../../src/store/types.js";
import type { CanonicalCapabilityId, NeighborKind } from "../../src/types.js";

export const record = (id: string, fields: Partial<UnvalidatedCapabilityRecord> = {}): UnvalidatedCapabilityRecord =>
  ({ capabilityId: id, name: id, description: "Description", whenToUse: "When needed", ...fields });

/** Contract double only; not evidence of a supported real database backend. */
export class FakeDatabase implements DatabaseReadView {
  provider = { providerId: "seed", name: "Seed", version: "1" };
  sourceRevision = "db:1";
  knowledgeRootDir?: string;
  closed = 0;
  scans = 0;
  reads = 0;
  pageSize = 1;
  onRead?: (id: string) => void;
  onScan?: () => void;
  constructor(public records: UnvalidatedCapabilityRecord[]) {}
  async getCapability(id: string) {
    this.reads++; this.onRead?.(id);
    if (this.closed) throw new Error("expired");
    return this.records.find((value) => value.capabilityId === id);
  }
  page<T>(items: readonly T[], page: StorePageRequest): StorePage<T> {
    const start = page.cursor === undefined ? 0 : Number(page.cursor);
    const count = Math.min(page.limit, this.pageSize);
    return { items: items.slice(start, start + count), ...(start + count < items.length ? { nextCursor: String(start + count) } : {}) };
  }
  async scanCapabilities(page: StorePageRequest) {
    this.scans++; this.onScan?.();
    if (this.closed) throw new Error("expired");
    return this.page(this.records, page);
  }
  async neighbors(id: string, kind: NeighborKind, page: StorePageRequest): Promise<StorePage<CanonicalCapabilityId>> {
    const source = this.records.find((item) => item.capabilityId === id);
    const reverse = { children: "parents", specializedBy: "specializes", relatedBy: "related", requiredBy: "requires" } as const;
    const ids = kind === "parents" || kind === "specializes" || kind === "related" || kind === "requires" ? (source?.[kind] ?? []) as string[] :
      this.records.filter((item) => item[reverse[kind]]?.includes(id)).map((item) => item.capabilityId);
    return this.page([...new Set(ids)].sort().map((capabilityId) => ({ providerId: this.provider.providerId, capabilityId })), page);
  }
  async close() { this.closed++; }
}
