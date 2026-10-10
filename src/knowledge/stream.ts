import { createHash } from "node:crypto";
import { CapabilityGraphError } from "../errors.js";
import type { KnowledgeDocumentRef } from "../types.js";
import { LocalFileReader } from "./local-file-reader.js";
import type { KnowledgeReadContext, KnowledgeReader, KnowledgeScanResult } from "./types.js";
import { locatorSource, readDocument } from "./read.js";

// Per graph, private, bounded byte copies. Sources without a strong proof are never reused.
const snapshotMaxBytes = 4_194_304;
interface Snapshot { reader: KnowledgeReader; bytes: Buffer; summary: KnowledgeScanResult }
const snapshots = new WeakMap<readonly KnowledgeReader[], Map<string, Snapshot>>();
export function clearDocumentSnapshots(readers: readonly KnowledgeReader[]) { snapshots.delete(readers); }

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
        cache.set(key, previous);
        const end = Math.min(previous.bytes.length, options.range?.endOffset ?? previous.bytes.length);
        try {
          for (let offset = options.range?.startOffset ?? 0; offset < end; offset += options.chunkBytes) {
            options.signal?.throwIfAborted();
            await consume(Uint8Array.from(previous.bytes.subarray(offset, Math.min(end, offset + options.chunkBytes))), offset);
          }
          options.signal?.throwIfAborted();
        } catch { throw new CapabilityGraphError("CG_READER_UNAVAILABLE", { nextAction: "repair_source" }); }
        return previous.summary;
      }
    }
  }
  let retained = cache ? Buffer.allocUnsafe(32768) : undefined;
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
  } catch (error) {
    if (error === contractFailure || (reader === local && error instanceof CapabilityGraphError)) throw error;
    throw new CapabilityGraphError(reader === local ? "CG_SOURCE_UNREADABLE" : "CG_READER_UNAVAILABLE", { nextAction: "repair_source" });
  }
  const summary = { contentId: `k:${hash.digest("hex").slice(0, 16)}`, totalBytes, contentType, source: locatorSource(ref) };
  if (cache && retained) {
    cache.delete(key);
    let cachedBytes = [...cache.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
    while (cache.size && (cache.size >= 16 || cachedBytes + totalBytes > snapshotMaxBytes)) {
      const oldest = cache.keys().next().value!; cachedBytes -= cache.get(oldest)!.bytes.length; cache.delete(oldest);
    }
    cache.set(key, { reader, bytes: Buffer.from(retained.subarray(0, totalBytes)), summary });
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
