import { createHash, type Hash } from "node:crypto";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";
import { canonicalJson, computeStaticRevision } from "../hash.js";
import { isId } from "../identity.js";
import { createKnowledgeMappingValidator } from "../validate/knowledge-ref.js";
import { validateCycles, validateEndpoints } from "../validate/cycles.js";
import { staticCapability } from "../validate/index.js";
import { validateCapability, validateProvider, type CapabilityRecord } from "../validate/schema.js";
import { freeze, RECORD_MAX_BYTES } from "../validate/values.js";
import type { CanonicalCapabilityId, NeighborKind } from "../types.js";
import type { DatabaseReadView, StorePage, StorePageRequest, ValidatedProviderView } from "./types.js";

const PAGE: StorePageRequest = { limit: 100, maxBytes: RECORD_MAX_BYTES };
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function edgeHash(hash: Hash, sourceId: string): void {
  const bytes = Buffer.from(sourceId, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length).update(bytes);
}

/** Core-owned wrapper keeps the last verified identity beside the adapter's opaque page cursor. */
interface QueryContinuation {
  readonly v: 1;
  readonly stream: string;
  readonly sourceCursor: string;
  readonly after: string;
}

function contract(reason: string): never {
  throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason } });
}

function queryContinuation(value: string | undefined, stream: string): QueryContinuation | undefined {
  if (value === undefined) return undefined;
  let continuation: QueryContinuation;
  try { continuation = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as QueryContinuation; }
  catch { throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" }); }
  if (!continuation || continuation.v !== 1 || continuation.stream !== stream ||
      typeof continuation.sourceCursor !== "string" || !continuation.sourceCursor || !isId(continuation.after)) {
    throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
  }
  return continuation;
}

function queryCursor(stream: string, sourceCursor: string, after: string): string {
  return Buffer.from(JSON.stringify({ v: 1, stream, sourceCursor, after } satisfies QueryContinuation)).toString("base64url");
}

function sourcePageRequest(request: StorePageRequest, continuation: QueryContinuation | undefined): StorePageRequest {
  return { limit: request.limit, maxBytes: request.maxBytes,
    ...(continuation === undefined ? {} : { cursor: continuation.sourceCursor }) };
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
 * A-E must all succeed before publication: ordered scan/hash, endpoints, three DAG checks,
 * complete dependency neighbor verification, then final readability.
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
    const acceptMappings = createKnowledgeMappingValidator();
    if (provider.specification) acceptMappings(provider.specification.documents);
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
          acceptMappings(record.knowledge);
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
    const incoming = new Map<string, { count: number; hash: Hash }>([...ids].map((id) => [id, { count: 0, hash: createHash("sha256") }]));
    for (const id of ids) {
      const record = await checked(id);
      validateEndpoints(record, ids);
      for (const target of record.requires) {
        const state = incoming.get(target)!;
        state.count++;
        edgeHash(state.hash, id);
      }
    }
    const expectedIncoming = new Map([...incoming].map(([id, state]) => [id, { count: state.count, digest: state.hash.digest("hex") }]));
    await validateCycles(ids, checked); // C: independent parents/specializes/requires traversals.
    async function drain(id: string, kind: "requires" | "requiredBy", options: {
      expected?: readonly string[]; start?: number; limit?: number; maxBytes?: number;
    } = {}): Promise<{ items: CanonicalCapabilityId[]; count: number; digest: string }> {
      const seenCursors = new Set<string>();
      const sourceHash = createHash("sha256");
      const items: CanonicalCapabilityId[] = [];
      let count = 0;
      let capped = false;
      let cursor: string | undefined;
      let previous: string | undefined;
      let pages = 0;
      do {
        const request = { ...PAGE, ...(cursor === undefined ? {} : { cursor }) };
        const page = pageShape(await call(() => view.neighbors(id, kind, request)), request);
        if (++pages > ids.size + 1) contract("neighbor_stream_unbounded");
        for (const endpoint of page.items) {
          if (!endpoint || endpoint.providerId !== provider.providerId || !isId(endpoint.capabilityId) || !ids.has(endpoint.capabilityId) ||
              (previous !== undefined && endpoint.capabilityId <= previous)) contract("neighbor_identity_invalid");
          previous = endpoint.capabilityId;
          if (options.expected && options.expected[count] !== previous) contract("requires_stream_mismatch");
          if (!capped && count >= (options.start ?? 0) && items.length < (options.limit ?? 0)) {
            const candidate = [...items, { providerId: provider.providerId, capabilityId: previous }];
            if (Buffer.byteLength(canonicalJson({ items: candidate, nextCursor: String(count + 1) }), "utf8") <= (options.maxBytes ?? 0)) {
              items.push(candidate.at(-1)!);
            } else capped = true;
          }
          count++;
          if (count > ids.size) contract("neighbor_stream_unbounded");
          edgeHash(sourceHash, previous);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) { if (seenCursors.has(cursor)) contract("repeated_store_cursor"); seenCursors.add(cursor); }
      } while (cursor !== undefined);
      if (options.expected && count !== options.expected.length) contract("requires_stream_mismatch");
      return { items, count, digest: sourceHash.digest("hex") };
    }
    // D compares complete streams, including the empty reverse stream, before publication.
    for (const id of ids) {
      const source = await checked(id);
      await drain(id, "requires", { expected: source.requires });
      const reverse = await drain(id, "requiredBy");
      const expected = expectedIncoming.get(id)!;
      if (reverse.count !== expected.count || reverse.digest !== expected.digest) contract("required_by_stream_mismatch");
    }
    stable();
    // E rechecks a real source operation; an empty graph must also prove its handle is still readable.
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
        const stream = "capabilities";
        const continuation = queryContinuation(bounded.cursor, stream);
        const sourceRequest = sourcePageRequest(bounded, continuation);
        const page = pageShape(await call(() => view.scanCapabilities(sourceRequest)), sourceRequest);
        let previous = continuation?.after;
        const items = [];
        for (const raw of page.items) {
          const record = await validateCapability(raw, root, false);
          if ((previous !== undefined && record.capabilityId <= previous) || hashes.get(record.capabilityId) !== digest(record)) contract("query_record_changed");
          previous = record.capabilityId;
          items.push(staticCapability(provider.providerId, record, revision));
        }
        return pageShape({ items, ...(page.nextCursor === undefined ? {} : {
          nextCursor: queryCursor(stream, page.nextCursor, previous!),
        }) }, bounded);
      },
      neighbors: async (id, kind, request) => {
        const bounded = { ...request, limit: Math.min(request.limit, 100), maxBytes: Math.min(request.maxBytes, RECORD_MAX_BYTES) };
        if (kind === "requires" || kind === "requiredBy") {
          if (!ids.has(id)) return { items: [] };
          const source = await checked(id);
          let all: readonly string[] = source.requires;
          if (kind === "requiredBy") {
            const start = bounded.cursor === undefined ? 0 : Number(bounded.cursor);
            if (!Number.isSafeInteger(start) || start < 0) throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
            const reverse = await drain(id, "requiredBy", { start, limit: bounded.limit, maxBytes: bounded.maxBytes });
            const expected = expectedIncoming.get(id)!;
            if (reverse.count !== expected.count || reverse.digest !== expected.digest) contract("required_by_stream_mismatch");
            if (start > reverse.count) throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
            if (start < reverse.count && !reverse.items.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
            const next = start + reverse.items.length;
            return { items: reverse.items, ...(next < reverse.count ? { nextCursor: String(next) } : {}) };
          }
          const start = bounded.cursor === undefined ? 0 : Number(bounded.cursor);
          if (!Number.isSafeInteger(start) || start < 0 || start > all.length) {
            throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
          }
          const items: CanonicalCapabilityId[] = [];
          let next = start;
          while (next < all.length && items.length < bounded.limit) {
            const candidate = [...items, { providerId: provider.providerId, capabilityId: all[next]! }];
            if (Buffer.byteLength(canonicalJson({ items: candidate, nextCursor: String(next + 1) }), "utf8") > bounded.maxBytes) {
              if (!items.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
              break;
            }
            items.push(candidate.at(-1)!); next++;
          }
          return { items, ...(next < all.length ? { nextCursor: String(next) } : {}) };
        }
        const stream = canonicalJson([id, kind]);
        const continuation = queryContinuation(bounded.cursor, stream);
        const sourceRequest = sourcePageRequest(bounded, continuation);
        const page = pageShape(await call(() => view.neighbors(id, kind, sourceRequest)), sourceRequest);
        const source = await checked(id);
        const items: CanonicalCapabilityId[] = [];
        const inverse = { children: "parents", specializedBy: "specializes", relatedBy: "related" } as const;
        let previous = continuation?.after;
        for (const endpoint of page.items) {
          if (!endpoint || endpoint.providerId !== provider.providerId || !isId(endpoint.capabilityId) || !ids.has(endpoint.capabilityId) ||
              (previous !== undefined && endpoint.capabilityId <= previous)) contract("neighbor_identity_invalid");
          previous = endpoint.capabilityId;
          if (kind === "parents" || kind === "specializes" || kind === "related") {
            if (!source[kind].includes(endpoint.capabilityId)) contract("neighbor_edge_mismatch");
          } else if (!(await checked(endpoint.capabilityId))[inverse[kind]].includes(id)) contract("neighbor_reverse_mismatch");
          items.push(freeze({ providerId: endpoint.providerId, capabilityId: endpoint.capabilityId }));
        }
        return pageShape({ items, ...(page.nextCursor === undefined ? {} : {
          nextCursor: queryCursor(stream, page.nextCursor, previous!),
        }) }, bounded);
      }, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}
