import { createHash } from "node:crypto";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";
import { canonicalJson, computeStaticRevision } from "../hash.js";
import { isId } from "../identity.js";
import { validateCycles, validateEndpoints } from "../validate/cycles.js";
import { staticCapability } from "../validate/index.js";
import { validateCapability, validateProvider, type CapabilityRecord } from "../validate/schema.js";
import { freeze, RECORD_MAX_BYTES } from "../validate/values.js";
import type { CanonicalCapabilityId } from "../types.js";
import type { DatabaseReadView, StorePage, StorePageRequest, ValidatedProviderView } from "./types.js";

const PAGE: StorePageRequest = { limit: 100, maxBytes: RECORD_MAX_BYTES };
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function contract(reason: string): never {
  throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason } });
}

function pageShape<T>(page: StorePage<T>, request: StorePageRequest): StorePage<T> {
  if (!page || !Array.isArray(page.items) || page.items.length > request.limit ||
      (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor || !page.items.length || page.nextCursor === request.cursor))) {
    contract("invalid_store_page");
  }
  if (Buffer.byteLength(canonicalJson(page), "utf8") > request.maxBytes) {
    throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "repair_source" });
  }
  return page;
}

/**
 * A-D must all succeed before publication: ordered scan/hash, endpoints, two DAG checks, final readability.
 * Retain O(V) IDs/digests, not full definitions; the adapter must supply stable repeated point reads.
 * On failure, close the candidate without masking the original validation error.
 */
export async function databaseAuthorityStore(view: DatabaseReadView, expectedProviderId: string): Promise<ValidatedProviderView> {
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await view.close(); } };
  try {
    const sourceRevision = view.sourceRevision;
    const declaredRoot = view.knowledgeRootDir;
    if (typeof sourceRevision !== "string" || !sourceRevision.trim() || (declaredRoot !== undefined && (typeof declaredRoot !== "string" || !declaredRoot))) contract("source_context_invalid");
    // Capture the effective root before validation awaits; keep checking the adapter's original declaration.
    const root = declaredRoot === undefined ? undefined : path.resolve(declaredRoot);
    const provider = await validateProvider(view.provider, root);
    if (provider.providerId !== expectedProviderId) contract("provider_identity_mismatch");
    const providerDigest = digest(view.provider);
    const ids = new Set<string>();
    const hashes = new Map<string, string>();
    const stable = () => {
      if (closed || view.sourceRevision !== sourceRevision) {
        throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
      }
      if (view.knowledgeRootDir !== declaredRoot || digest(view.provider) !== providerDigest) contract("source_context_changed");
    };
    const call = async <T>(read: () => Promise<T>): Promise<T> => { stable(); const value = await read(); stable(); return value; };
    async function* scan() {
      let cursor: string | undefined;
      let previous: string | undefined;
      const cursors = new Set<string>();
      do {
        const request = { ...PAGE, ...(cursor === undefined ? {} : { cursor }) };
        const page = pageShape(await call(() => view.scanCapabilities(request)), request);
        for (const raw of page.items) {
          const record = await validateCapability(raw, root);
          if (previous !== undefined && record.capabilityId <= previous) contract("scan_order_or_duplicate");
          previous = record.capabilityId;
          ids.add(record.capabilityId);
          hashes.set(record.capabilityId, digest(record));
          yield record;
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) { if (cursors.has(cursor)) contract("repeated_store_cursor"); cursors.add(cursor); }
      } while (cursor !== undefined);
    }
    const revision = await computeStaticRevision(provider, scan()); // A: not yet safe to publish.
    const checked = async (id: string): Promise<CapabilityRecord> => {
      const raw = await call(() => view.getCapability(id));
      if (raw === undefined) contract("record_disappeared");
      // Source records are revalidated, but external document availability is a Reader concern after A.
      const record = await validateCapability(raw, root, false);
      if (record.capabilityId !== id || hashes.get(id) !== digest(record)) contract("record_changed");
      return record;
    };
    // B waits for all IDs: a valid a -> z edge would look dangling while scanning a before z.
    for (const id of ids) validateEndpoints(await checked(id), ids);
    await validateCycles(ids, checked); // C: independent parents/specializes traversals.
    stable();
    // D rechecks a real source operation; an empty graph must also prove its handle is still readable.
    const first = ids.values().next().value as string | undefined;
    if (first !== undefined) await checked(first);
    else {
      const empty = pageShape(await call(() => view.scanCapabilities(PAGE)), PAGE);
      if (empty.items.length || empty.nextCursor !== undefined) contract("empty_view_changed");
    }
    return { provider: freeze({ ...provider, authorityKind: "database" }), staticRevision: revision,
      sourceContext: freeze({ providerId: provider.providerId, authorityKind: "database", sourceRevision,
        ...(root === undefined ? {} : { knowledgeRootDir: root }) }),
      assertReadable: async () => {
        stable();
        if (first !== undefined) await checked(first);
        else {
          const page = pageShape(await call(() => view.scanCapabilities(PAGE)), PAGE);
          if (page.items.length || page.nextCursor !== undefined) contract("empty_view_changed");
        }
      },
      getCapability: async (id) => {
        stable();
        if (!ids.has(id)) return undefined;
        return staticCapability(provider.providerId, await checked(id), revision);
      },
      listCapabilities: async (request) => {
        const bounded = { ...request, limit: Math.min(request.limit, 100), maxBytes: Math.min(request.maxBytes, RECORD_MAX_BYTES) };
        const page = pageShape(await call(() => view.scanCapabilities(bounded)), bounded);
        let previous: string | undefined;
        const items = [];
        for (const raw of page.items) {
          const record = await validateCapability(raw, root, false);
          if ((previous !== undefined && record.capabilityId <= previous) || hashes.get(record.capabilityId) !== digest(record)) contract("query_record_changed");
          previous = record.capabilityId;
          items.push(staticCapability(provider.providerId, record, revision));
        }
        return { items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
      },
      neighbors: async (id, kind, request) => {
        const bounded = { ...request, limit: Math.min(request.limit, 100), maxBytes: Math.min(request.maxBytes, RECORD_MAX_BYTES) };
        const page = pageShape(await call(() => view.neighbors(id, kind, bounded)), bounded);
        const source = await checked(id);
        const items: CanonicalCapabilityId[] = [];
        const inverse = { children: "parents", specializedBy: "specializes", relatedBy: "related" } as const;
        let previous: string | undefined;
        for (const endpoint of page.items) {
          if (!endpoint || endpoint.providerId !== provider.providerId || !isId(endpoint.capabilityId) || !ids.has(endpoint.capabilityId) ||
              (previous !== undefined && endpoint.capabilityId <= previous)) contract("neighbor_identity_invalid");
          previous = endpoint.capabilityId;
          if (kind === "parents" || kind === "specializes" || kind === "related") {
            if (!source[kind].includes(endpoint.capabilityId)) contract("neighbor_edge_mismatch");
          } else if (!(await checked(endpoint.capabilityId))[inverse[kind]].includes(id)) contract("neighbor_reverse_mismatch");
          items.push(freeze({ providerId: endpoint.providerId, capabilityId: endpoint.capabilityId }));
        }
        return { items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
      }, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
