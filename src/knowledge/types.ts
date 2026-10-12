import type { ProviderSourceContext } from "../store/types.js";
import type { KnowledgeContentId, KnowledgeDocumentRef, KnowledgeRef, StaticRevision } from "../types.js";
/** Local Reader-only context. Never serialize sourceContext into a public response. */
export interface KnowledgeReadContext {
  readonly providerId: string; readonly staticRevision: StaticRevision; readonly sourceContext: ProviderSourceContext;
}
/** Optional source reader; the built-in local reader always handles relative-file Documents first. */
export interface KnowledgeReader {
  readonly id: string;
  /** Synchronous source match. Core picks the first matching custom reader only for nonlocal sources. */
  canRead(ref: KnowledgeRef): boolean;
  /** Return exact bounded bytes and their k: content hash; source must equal the declared locator. Own I/O cleanup here. */
  read(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, budget: { maxBytes: number; signal?: AbortSignal }): Promise<{
    bytes: Uint8Array; contentType: string; contentId: KnowledgeContentId; source: string;
  }>;
  /** Optional bounded-memory transport. Core hashes the entire stream; total document size is not capped.
   * Each chunk must fit chunkBytes. Abort must stop I/O, and iterator return must release owned resources. */
  stream?(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, options: {
    chunkBytes: number; signal?: AbortSignal;
  }): AsyncIterable<{ bytes: Uint8Array; contentType: string; source: string }>;
  /** Optional proof that the current source still matches a previously fully hashed contentId.
   * Return true only after revalidation with a strong validator or immutable source identity.
   * False requests a full scan; unavailable/aborted verification must throw. Never use timestamps alone.
   * Core may retain a bounded private snapshot for body pages; this does not cap document size. */
  isContentCurrent?(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, contentId: KnowledgeContentId,
    options: { signal?: AbortSignal }): Promise<boolean>;
  /** Optional exact range of an already fully scanned representation. Core first revalidates
   * isContentCurrent, then verifies these bytes against its private block hashes.
   * contentId identifies the complete source, not the returned range. Return undefined to
   * request a full scan when the representation is unavailable; throw on I/O failure.
   * Offsets are UTF-8 bytes, end-exclusive; cancellation must release owned resources. */
  readRange?(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, options: {
    contentId: KnowledgeContentId; startOffset: number; endOffset: number; signal?: AbortSignal;
  }): Promise<{ bytes: Uint8Array; contentId: KnowledgeContentId; contentType: string;
    source: string; totalBytes: number } | undefined>;
}
export interface KnowledgeScanResult {
  readonly contentId: KnowledgeContentId; readonly totalBytes: number; readonly contentType: string; readonly source: string;
}
