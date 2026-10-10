import { createHash } from "node:crypto";
import { CapabilityGraphError } from "../errors.js";
import type { KnowledgeDocumentRef } from "../types.js";
import { LocalFileReader } from "./local-file-reader.js";
import type { KnowledgeReadContext, KnowledgeReader, KnowledgeScanResult } from "./types.js";
import { locatorSource, readDocument } from "./read.js";

// Per graph, private, bounded byte copies. Sources without a strong proof are never reused.
const snapshotMaxBytes = 4_194_304;
const proofBlockBytes = 32768;
interface Snapshot { reader: KnowledgeReader; bytes?: Buffer; hashes?: Buffer; summary: KnowledgeScanResult }
const snapshotBytes = (snapshot: Snapshot) => (snapshot.bytes?.length ?? 0) + (snapshot.hashes?.length ?? 0);
const snapshots = new WeakMap<readonly KnowledgeReader[], Map<string, Snapshot>>();
export function clearDocumentSnapshots(readers: readonly KnowledgeReader[]) { snapshots.delete(readers); }
function rememberSnapshot(cache: Map<string, Snapshot>, key: string, snapshot: Snapshot): void {
  cache.delete(key);
  let cachedBytes = [...cache.values()].reduce((sum, entry) => sum + snapshotBytes(entry), 0);
  while (cache.size && (cache.size >= 16 || cachedBytes + snapshotBytes(snapshot) > snapshotMaxBytes)) {
    const oldest = cache.keys().next().value!; cachedBytes -= snapshotBytes(cache.get(oldest)!); cache.delete(oldest);
  }
  cache.set(key, snapshot);
}

/** Hash complete source bytes while retaining only the consumer's bounded working set. */
export async function scanDocument(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, readers: readonly KnowledgeReader[],
  consume: (bytes: Uint8Array, offset: number) => void | Promise<void>,
  options: { chunkBytes: number; fallbackMaxBytes: number; signal?: AbortSignal; reuseStableSnapshot?: boolean;
    range?: { startOffset: number; endOffset: number } }): Promise<KnowledgeScanResult> {
  const local = new LocalFileReader();
  let reader: KnowledgeReader | undefined;
  try { reader = local.canRead(ref) ? local : readers.find((item) => item.canRead(ref)); }
  catch { throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" }); }
  if (!reader) throw new CapabilityGraphError("CG_READER_UNCONFIGURED", { nextAction: "configure_backend" });
  if (!reader.stream) {
    if (options.signal) throw new CapabilityGraphError("CG_READER_UNCONFIGURED", { nextAction: "configure_backend", details: { reason: "reader_cancellation_unsupported" } });
    const body = await readDocument(ref, context, options.fallbackMaxBytes, readers);
    try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body.bytes); }
    catch { throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { reason: "invalid_utf8" } }); }
    for (let offset = 0; offset < body.bytes.length; offset += options.chunkBytes) await consume(body.bytes.slice(offset, offset + options.chunkBytes), offset);
    return { contentId: body.contentId, contentType: body.contentType, source: body.source, totalBytes: body.bytes.length };
  }
  let cache: Map<string, Snapshot> | undefined;
  const key = JSON.stringify([context.providerId, context.staticRevision, context.sourceContext.sourceRevision, ref.knowledgeId, locatorSource(ref)]);
  if (options.reuseStableSnapshot && reader.isContentCurrent) {
    cache = snapshots.get(readers);
    if (!cache) { cache = new Map(); snapshots.set(readers, cache); }
    const previous = cache.get(key);
    if (previous) {
      let current: boolean = false;
      if (previous.reader === reader) {
        try {
          options.signal?.throwIfAborted();
          current = await reader.isContentCurrent(ref, context, previous.summary.contentId, options.signal ? { signal: options.signal } : {});
          options.signal?.throwIfAborted();
        } catch { cache.delete(key); throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" }); }
        if (typeof current !== "boolean") { cache.delete(key); throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source" }); }
      }
      cache.delete(key);
      if (current) {
        try {
          if (previous.bytes) {
            const end = Math.min(previous.bytes.length, options.range?.endOffset ?? previous.bytes.length);
            for (let offset = options.range?.startOffset ?? 0; offset < end; offset += options.chunkBytes) {
              options.signal?.throwIfAborted();
              await consume(Uint8Array.from(previous.bytes.subarray(offset, Math.min(end, offset + options.chunkBytes))), offset);
            }
            options.signal?.throwIfAborted(); rememberSnapshot(cache, key, previous); return previous.summary;
          }
          if (previous.hashes && reader.readRange && options.range) {
            options.signal?.throwIfAborted();
            const end = Math.min(previous.summary.totalBytes, options.range.endOffset);
            if (options.range.startOffset > end) { rememberSnapshot(cache, key, previous); return previous.summary; }
            const startOffset = Math.floor(options.range.startOffset / proofBlockBytes) * proofBlockBytes;
            const endOffset = Math.min(previous.summary.totalBytes, Math.ceil(end / proofBlockBytes) * proofBlockBytes);
            const body = await reader.readRange(ref, context, { contentId: previous.summary.contentId, startOffset, endOffset,
              ...(options.signal ? { signal: options.signal } : {}) });
            options.signal?.throwIfAborted();
            if (body !== undefined) {
              const invalid = (reason: string) => new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason } });
              if (!body || !(body.bytes instanceof Uint8Array) || body.bytes.length !== endOffset - startOffset ||
                  body.contentId !== previous.summary.contentId || body.source !== previous.summary.source ||
                  body.contentType !== previous.summary.contentType || body.totalBytes !== previous.summary.totalBytes) throw invalid("reader_range_invalid");
              const bytes = Buffer.from(body.bytes);
              for (let offset = 0; offset < bytes.length; offset += proofBlockBytes) {
                const index = (startOffset + offset) / proofBlockBytes;
                const expected = previous.hashes.subarray(index * 32, (index + 1) * 32);
                const actual = createHash("sha256").update(bytes.subarray(offset, offset + proofBlockBytes)).digest();
                if (!actual.equals(expected)) throw invalid("reader_range_hash_mismatch");
              }
              for (let offset = options.range.startOffset; offset < end; offset += options.chunkBytes) {
                options.signal?.throwIfAborted();
                await consume(Uint8Array.from(bytes.subarray(offset - startOffset, Math.min(end, offset + options.chunkBytes) - startOffset)), offset);
              }
              options.signal?.throwIfAborted(); rememberSnapshot(cache, key, previous); return previous.summary;
            }
          }
        } catch (error) {
          if (error instanceof CapabilityGraphError && error.code === "CG_ADAPTER_CONTRACT_INVALID") throw error;
          throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" });
        }
      }
    }
  }
  let retained = cache ? Buffer.allocUnsafe(32768) : undefined;
  // Flat fixed-block digests share the existing private cache budget. They let Core verify
  // an external range independently without retaining a large body or trusting its claimed hash.
  let proofHashes = cache && reader.readRange ? Buffer.allocUnsafe(1024) : undefined;
  let proofHash = proofHashes ? createHash("sha256") : undefined; let proofUsed = 0; let proofLength = 0;
  const finishProof = () => {
    if (!proofHashes || !proofHash) return;
    const required = proofLength + 32;
    if (required > snapshotMaxBytes) { proofHashes = undefined; proofHash = undefined; return; }
    if (required > proofHashes.length) {
      const larger = Buffer.allocUnsafe(Math.min(snapshotMaxBytes, proofHashes.length * 2));
      proofHashes.copy(larger, 0, 0, proofLength); proofHashes = larger;
    }
    proofHashes.set(proofHash.digest(), proofLength); proofLength = required;
    proofHash = createHash("sha256"); proofUsed = 0;
  };
  const hash = createHash("sha256"); let totalBytes = 0; let contentType: string | undefined;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let contractFailure: CapabilityGraphError | undefined;
  try {
    for await (const raw of reader.stream(ref, context, { chunkBytes: options.chunkBytes, ...(options.signal ? { signal: options.signal } : {}) })) {
      options.signal?.throwIfAborted();
      if (!raw || !(raw.bytes instanceof Uint8Array) || raw.bytes.length > options.chunkBytes ||
          raw.source !== locatorSource(ref) || typeof raw.contentType !== "string" || !raw.contentType.trim() ||
          (contentType !== undefined && raw.contentType !== contentType)) {
        contractFailure = new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason: "reader_stream_invalid" } });
        throw contractFailure;
      }
      const bytes = Uint8Array.from(raw.bytes); contentType = raw.contentType;
      decoder.decode(bytes, { stream: true }); hash.update(bytes);
      for (let offset = 0; proofHash && offset < bytes.length;) {
        const end = Math.min(bytes.length, offset + proofBlockBytes - proofUsed);
        proofHash.update(bytes.subarray(offset, end)); proofUsed += end - offset; offset = end;
        if (proofUsed === proofBlockBytes) finishProof();
      }
      if (retained) {
        const required = totalBytes + bytes.length;
        if (required > snapshotMaxBytes) retained = undefined;
        else {
          if (required > retained.length) {
            const larger = Buffer.allocUnsafe(Math.min(snapshotMaxBytes, Math.max(required, retained.length * 2)));
            retained.copy(larger, 0, 0, totalBytes); retained = larger;
          }
          retained.set(bytes, totalBytes);
        }
      }
      await consume(bytes, totalBytes); totalBytes += bytes.length;
      if (!Number.isSafeInteger(totalBytes)) throw new Error("Source size invalid");
    }
    decoder.decode(); options.signal?.throwIfAborted();
    if (contentType === undefined) throw new Error("Missing stream metadata");
    if (proofUsed) finishProof();
  } catch (error) {
    if (error === contractFailure || (reader === local && error instanceof CapabilityGraphError)) throw error;
    throw new CapabilityGraphError(reader === local ? "CG_SOURCE_UNREADABLE" : "CG_READER_UNAVAILABLE", { nextAction: "repair_source" });
  }
  const summary = { contentId: `k:${hash.digest("hex").slice(0, 16)}`, totalBytes, contentType, source: locatorSource(ref) };
  if (cache && (retained || proofHashes)) {
    const snapshot: Snapshot = { reader, summary, ...(retained ? { bytes: Buffer.from(retained.subarray(0, totalBytes)) }
      : { hashes: Buffer.from(proofHashes!.subarray(0, proofLength)) }) };
    rememberSnapshot(cache, key, snapshot);
  }
  return summary;
}

/** Full-source hash plus a bounded range. No HTTP Range support is assumed. */
export async function documentRange(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, readers: readonly KnowledgeReader[],
  options: { startOffset: number; maxBytes: number; fallbackMaxBytes: number; signal?: AbortSignal; preferBoundary?: boolean }) {
  const parts: Uint8Array[] = []; let length = 0;
  const summary = await scanDocument(ref, context, readers, (bytes, offset) => {
    const start = Math.max(0, options.startOffset - offset);
    const end = Math.min(bytes.length, options.startOffset + options.maxBytes + 4 - offset);
    if (end > start) { const part = bytes.slice(start, end); parts.push(part); length += part.length; }
  }, { chunkBytes: Math.min(32768, options.maxBytes + 4), fallbackMaxBytes: options.fallbackMaxBytes,
    reuseStableSnapshot: true, range: { startOffset: options.startOffset, endOffset: options.startOffset + options.maxBytes + 4 },
    ...(options.signal ? { signal: options.signal } : {}) });
  if (options.startOffset > summary.totalBytes) throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
  const buffer = Buffer.concat(parts, length);
  if (buffer.length && (buffer[0]! & 0xc0) === 0x80) throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input", details: { reason: "offset_not_utf8_boundary" } });
  let end = Math.min(options.maxBytes, buffer.length);
  while (end < buffer.length && end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  if (!end && buffer.length) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter", details: { reason: "page_smaller_than_codepoint" } });
  if (options.preferBoundary && options.startOffset + end < summary.totalBytes) {
    // Prefer paragraph/fence boundaries; overlong blocks remain readable by UTF-8 ranges.
    const text = buffer.subarray(0, end).toString("utf8");
    // Offsets increase monotonically: only the last candidate needs UTF-8 conversion.
    // Counting every prefix makes short paragraphs quadratic in the page size.
    let lastBoundary = 0;
    for (const match of text.matchAll(/\r?\n\r?\n|\r?\n(?:```|~~~)[^\r\n]*\r?\n/g)) {
      lastBoundary = match.index! + match[0].length;
    }
    const preferred = Buffer.byteLength(text.slice(0, lastBoundary));
    if (preferred >= end / 2 && preferred > 0) end = preferred;
  }
  const bytes = Uint8Array.from(buffer.subarray(0, end));
  return { ...summary, bytes, startOffset: options.startOffset, endOffset: options.startOffset + end };
}

/** Verify several already-bounded snippets with one complete-source scan. Retain only their bytes. */
export async function documentRanges(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, readers: readonly KnowledgeReader[],
  ranges: readonly { startOffset: number; endOffset: number }[], fallbackMaxBytes: number, chunkBytes: number) {
  const parts = ranges.map(() => [] as Uint8Array[]);
  const summary = await scanDocument(ref, context, readers, (bytes, offset) => {
    for (const [index, range] of ranges.entries()) {
      const start = Math.max(0, range.startOffset - offset);
      const end = Math.min(bytes.length, range.endOffset - offset);
      if (end > start) parts[index]!.push(bytes.slice(start, end));
    }
  }, { chunkBytes: Math.min(32768, chunkBytes), fallbackMaxBytes });
  return { ...summary, ranges: parts.map((value) => Buffer.concat(value)) };
}
