import { createHash } from "node:crypto";
import { request as httpRequest, type Agent, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeReader, KnowledgeDocumentRef, KnowledgeReadContext } from "@devcodex/capability-graph";

type ReadResult = Awaited<ReturnType<KnowledgeReader["read"]>>;
type FileIdentity = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
interface Snapshot { file: string; identity: FileIdentity; etag: string; sha256: string; contentType: string; bytes: number; expires: number; leases: number; retired: boolean }
interface SnapshotOptions { directory: string; maxBytes?: number; maxEntries?: number; ttlMs?: number }
interface Options { allowedOrigins: readonly string[]; timeoutMs?: number; maxConcurrent?: number;
  /** Host-owned Agent (e.g. proxy-agent on Node 20/22/24); Reader never closes it. */
  agentForUrl?: (url: URL) => Agent | false; snapshot?: SnapshotOptions }

/** Source reference, not an npm export. Exact bytes, explicit origins and optional host-managed snapshots. */
export class HttpKnowledgeReader implements KnowledgeReader {
  readonly id = "seed-http-knowledge";
  private readonly origins: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly requests = new Set<ClientRequest>();
  private readonly streams = new Set<Promise<void>>();
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly snapshotLimits?: { maxBytes: number; maxEntries: number; ttlMs: number };
  private directory?: Promise<string>;
  private closed = false;
  readonly readRange?: NonNullable<KnowledgeReader["readRange"]>;
  constructor(private readonly options: Options) {
    this.timeoutMs = options.timeoutMs ?? 2000; this.maxConcurrent = options.maxConcurrent ?? 4;
    if (![this.timeoutMs, this.maxConcurrent].every((value) => Number.isSafeInteger(value) && value > 0) || !options.allowedOrigins.length) throw new Error("Explicit origins and positive HTTP limits are required");
    this.origins = new Set(options.allowedOrigins.map((value) => {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error("Invalid origin");
      return url.origin;
    }));
    if (options.snapshot) {
      if (!path.isAbsolute(options.snapshot.directory)) throw new Error("Snapshot directory must be an absolute host-owned path outside the source checkout");
      this.snapshotLimits = { maxBytes: options.snapshot.maxBytes ?? 16_777_216, maxEntries: options.snapshot.maxEntries ?? 8, ttlMs: options.snapshot.ttlMs ?? 300_000 };
      if (!Object.values(this.snapshotLimits).every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid snapshot budgets");
      this.readRange = this.readSnapshotRange.bind(this);
    }
  }
  get activeRequests(): number { return this.requests.size; }
  get cachedSnapshotBytes(): number { return [...this.snapshots.values()].reduce((sum, value) => sum + value.bytes, 0); }
  canRead(ref: Parameters<KnowledgeReader["canRead"]>[0]): boolean { return ref.kind === "document" && ref.locator.type === "http"; }
  private async retire(source: string) {
    const snapshot = this.snapshots.get(source); if (!snapshot) return;
    this.snapshots.delete(source); snapshot.retired = true;
    if (!snapshot.leases) await rm(snapshot.file, { force: true });
  }
  private async snapshotDirectory(): Promise<string> {
    return this.directory ??= (async () => { await mkdir(this.options.snapshot!.directory, { recursive: true }); return mkdtemp(path.join(this.options.snapshot!.directory, "cg-http-")); })();
  }
  /** Revalidate the exact representation already hashed by Core, without rereading the disk snapshot.
   * Conditional HEAD has no body. Unsupported HEAD or a changed validator requests a full stream. */
  async isContentCurrent(ref: KnowledgeDocumentRef, _context: KnowledgeReadContext, contentId: string, options: { signal?: AbortSignal }): Promise<boolean> {
    if (this.closed || ref.locator.type !== "http") throw new Error("Reader unavailable");
    const source = ref.locator.url; const url = new URL(source);
    if (!this.origins.has(url.origin) || url.username || url.password || this.streams.size >= this.maxConcurrent) throw new Error("Source unavailable");
    options.signal?.throwIfAborted();
    const snapshot = this.snapshots.get(source);
    if (!snapshot || snapshot.expires <= Date.now() || contentId !== `k:${snapshot.sha256.slice(0, 16)}`) return false;
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); this.streams.add(done);
    let request: ClientRequest | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => request?.destroy(new Error("HTTP knowledge verification aborted"));
    try {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "HEAD", agent: this.options.agentForUrl?.(url) ?? false,
          headers: { "accept-encoding": "identity", accept: "text/plain, text/markdown, application/json", "if-none-match": snapshot.etag },
        }, resolve);
        this.requests.add(request); request.on("error", reject); options.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => request?.destroy(new Error("HTTP knowledge deadline exceeded")), this.timeoutMs); request.end();
      });
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") throw new Error("Encoded source unsupported");
      response.resume(); await new Promise<void>((resolve, reject) => { response.once("end", resolve); response.once("error", reject); });
      options.signal?.throwIfAborted(); if (this.closed || !response.complete) throw new Error("Reader unavailable");
      if (response.statusCode === 304) {
        if (response.headers.etag !== undefined && response.headers.etag !== snapshot.etag) throw new Error("Unbound conditional response");
        return true;
      }
      if ([200, 405, 501].includes(response.statusCode ?? 0)) return false;
      throw new Error("Source unavailable");
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (request) { request.destroy(); if (!request.closed) await new Promise<void>((resolve) => request!.once("close", resolve)); this.requests.delete(request); }
      finish(); this.streams.delete(done);
    }
  }
  /** Read only a leased, fully downloaded representation after Core's strong revalidation.
   * Core independently verifies aligned block hashes; file identity detects local replacement
   * or edits early, and is never used as proof that the remote source is current. */
  private async readSnapshotRange(ref: KnowledgeDocumentRef, _context: KnowledgeReadContext,
    options: Parameters<NonNullable<KnowledgeReader["readRange"]>>[2]): ReturnType<NonNullable<KnowledgeReader["readRange"]>> {
    if (this.closed || ref.locator.type !== "http" || this.streams.size >= this.maxConcurrent) throw new Error("Reader unavailable");
    if (![options.startOffset, options.endOffset].every(Number.isSafeInteger) || options.startOffset < 0 || options.endOffset < options.startOffset) throw new Error("Invalid range");
    options.signal?.throwIfAborted();
    const source = ref.locator.url; const snapshot = this.snapshots.get(source);
    if (!snapshot || snapshot.expires <= Date.now() || options.contentId !== `k:${snapshot.sha256.slice(0, 16)}`) return undefined;
    if (options.endOffset > snapshot.bytes) throw new Error("Invalid range");
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); this.streams.add(done);
    snapshot.leases++; let handle: FileHandle | undefined;
    const unchanged = (actual: FileIdentity) => Object.entries(snapshot.identity).every(([key, value]) => actual[key as keyof FileIdentity] === value);
    try {
      try { handle = await open(snapshot.file, "r"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (this.snapshots.get(source) === snapshot) await this.retire(source);
        return undefined;
      }
      if (!unchanged(await handle.stat({ bigint: true }))) throw new Error("Snapshot changed");
      const bytes = Buffer.alloc(options.endOffset - options.startOffset); let offset = 0;
      while (offset < bytes.length) {
        options.signal?.throwIfAborted(); if (this.closed) throw new Error("Reader unavailable");
        const { bytesRead } = await handle.read(bytes, offset, Math.min(32768, bytes.length - offset), options.startOffset + offset);
        if (!bytesRead) throw new Error("Snapshot incomplete"); offset += bytesRead;
      }
      options.signal?.throwIfAborted(); if (this.closed || !unchanged(await handle.stat({ bigint: true }))) throw new Error("Snapshot changed");
      if (this.snapshots.get(source) === snapshot) { this.snapshots.delete(source); this.snapshots.set(source, snapshot); }
      return { bytes, contentId: options.contentId, source, contentType: snapshot.contentType, totalBytes: snapshot.bytes };
    } catch (error) {
      if (this.snapshots.get(source) === snapshot) await this.retire(source);
      throw error;
    } finally {
      try {
        try { await handle?.close(); }
        finally {
          snapshot.leases--;
          if (snapshot.retired && !snapshot.leases) await rm(snapshot.file, { force: true });
        }
      } finally { finish(); this.streams.delete(done); }
    }
  }
  /** Strong ETag validates a previously complete disk snapshot; weak/no validator falls back to full GET.
   * Normal streams still verify complete bytes; Core may reuse its own proved copy for body pages. No 206 is accepted. */
  async *stream(ref: KnowledgeDocumentRef, _context: KnowledgeReadContext, options: { chunkBytes: number; signal?: AbortSignal }) {
    if (this.closed || ref.locator.type !== "http" || !Number.isSafeInteger(options.chunkBytes) || options.chunkBytes < 1) throw new Error("Reader unavailable");
    const source = ref.locator.url; const url = new URL(source);
    if (!this.origins.has(url.origin) || url.username || url.password || this.streams.size >= this.maxConcurrent) throw new Error("Source unavailable");
    options.signal?.throwIfAborted();
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); this.streams.add(done);
    let request: ClientRequest | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    let snapshot = this.snapshots.get(source); let handle: FileHandle | undefined; let temporary: string | undefined;
    let writer: FileHandle | undefined; let published = false; let leased = false; let expired = false;
    const abort = () => request?.destroy(new Error("HTTP knowledge transfer aborted"));
    try {
      if (snapshot && snapshot.expires <= Date.now()) { await this.retire(source); snapshot = undefined; }
      if (snapshot) {
        snapshot.leases++; leased = true;
        try { handle = await open(snapshot.file, "r"); }
        catch {
          if (this.snapshots.get(source) === snapshot) await this.retire(source);
          snapshot.leases--;
          if (snapshot.retired && !snapshot.leases) await rm(snapshot.file, { force: true });
          snapshot = undefined; leased = false;
        }
      }
      options.signal?.throwIfAborted(); if (this.closed) throw new Error("Reader closed");
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "GET", agent: this.options.agentForUrl?.(url) ?? false,
          headers: { "accept-encoding": "identity", accept: "text/plain, text/markdown, application/json", ...(snapshot ? { "if-none-match": snapshot.etag } : {}) },
        }, resolve);
        this.requests.add(request); request.on("error", reject); options.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { expired = true; request?.destroy(new Error("HTTP knowledge deadline exceeded")); }, this.timeoutMs); request.end();
      });
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") throw new Error("Encoded source unsupported");
      if (response.statusCode === 304) {
        if (!snapshot || !handle || (response.headers.etag !== undefined && response.headers.etag !== snapshot.etag)) throw new Error("Unbound conditional response");
        response.resume(); await new Promise<void>((resolve, reject) => { response.once("end", resolve); response.once("error", reject); });
        const buffer = Buffer.alloc(Math.min(options.chunkBytes, Math.max(1, snapshot.bytes))); let total = 0;
        const snapshotHash = createHash("sha256");
        while (true) {
          options.signal?.throwIfAborted(); if (this.closed || expired) throw new Error("Reader unavailable");
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
          total += bytesRead; snapshotHash.update(buffer.subarray(0, bytesRead)); yield { bytes: Uint8Array.from(buffer.subarray(0, bytesRead)), source, contentType: snapshot.contentType };
        }
        if (total !== snapshot.bytes || snapshotHash.digest("hex") !== snapshot.sha256) {
          if (this.snapshots.get(source) === snapshot) await this.retire(source);
          throw new Error("Snapshot changed");
        }
        if (this.snapshots.get(source) === snapshot) { this.snapshots.delete(source); this.snapshots.set(source, snapshot); }
        if (!total) yield { bytes: new Uint8Array(), source, contentType: snapshot.contentType };
        return;
      }
      if (response.statusCode !== 200) throw new Error("Source unavailable");
      const contentType = response.headers["content-type"] ?? "text/plain; charset=utf-8";
      if (!/^(?:text\/(?:plain|markdown|x-markdown)|application\/(?:json|[^;]+\+json))(?:;|$)/i.test(contentType)) throw new Error("Use a raw UTF-8 document URL; HTML/binary extraction requires a separate Reader");
      const etag = response.headers.etag; const reliable = typeof etag === "string" && /^"[^"\r\n]*"$/.test(etag);
      await this.retire(source);
      if (this.snapshotLimits && reliable) {
        temporary = path.join(await this.snapshotDirectory(), `${createHash("sha256").update(source).update(String(Math.random())).digest("hex")}.body`);
        writer = await open(temporary, "wx", 0o600);
      }
      let total = 0; let emitted = false; const sourceHash = createHash("sha256");
      for await (const chunk of response) {
        options.signal?.throwIfAborted(); if (this.closed || expired) throw new Error("Reader unavailable");
        const bytes = Buffer.from(chunk); total += bytes.length; sourceHash.update(bytes);
        if (writer && total > this.snapshotLimits!.maxBytes) { await writer.close(); writer = undefined; await rm(temporary!, { force: true }); temporary = undefined; }
        if (writer) await writer.writeFile(bytes);
        for (let offset = 0; offset < bytes.length; offset += options.chunkBytes) {
          emitted = true; yield { bytes: bytes.subarray(offset, offset + options.chunkBytes), source, contentType };
        }
      }
      if (!response.complete) throw new Error("Incomplete source");
      if (!emitted) yield { bytes: new Uint8Array(), source, contentType };
      if (writer && temporary && !this.closed) {
        await writer.close(); writer = undefined;
        const inspection = await open(temporary, "r"); let identity: FileIdentity;
        try {
          const stat = await inspection.stat({ bigint: true });
          identity = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
        } finally { await inspection.close(); }
        while (this.snapshots.size && (this.snapshots.size >= this.snapshotLimits!.maxEntries || this.cachedSnapshotBytes + total > this.snapshotLimits!.maxBytes)) await this.retire(this.snapshots.keys().next().value!);
        await this.retire(source);
        this.snapshots.set(source, { file: temporary, identity, etag: etag!, sha256: sourceHash.digest("hex"), bytes: total, contentType, expires: Date.now() + this.snapshotLimits!.ttlMs, leases: 0, retired: false }); published = true;
      }
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      try {
        const cleanup = await Promise.allSettled([handle?.close(), writer?.close()]);
        if (snapshot && leased) { snapshot.leases--; if (snapshot.retired && !snapshot.leases) await rm(snapshot.file, { force: true }); }
        if (temporary && !published) await rm(temporary, { force: true });
        if (cleanup.some((result) => result.status === "rejected")) throw new Error("Snapshot cleanup failed");
      } finally {
        if (request) { request.destroy(); if (!request.closed) await new Promise<void>((resolve) => request!.once("close", resolve)); this.requests.delete(request); }
        finish(); this.streams.delete(done);
      }
    }
  }
  async read(ref: KnowledgeDocumentRef, context: KnowledgeReadContext, budget: { maxBytes: number }): Promise<ReadResult> {
    if (!Number.isSafeInteger(budget.maxBytes) || budget.maxBytes < 1) throw new Error("Invalid read budget");
    const chunks: Buffer[] = []; let length = 0; let contentType = "";
    for await (const chunk of this.stream(ref, context, { chunkBytes: Math.min(32768, budget.maxBytes) })) {
      length += chunk.bytes.length; if (length > budget.maxBytes) throw new Error("Read budget exceeded");
      chunks.push(Buffer.from(chunk.bytes)); contentType = chunk.contentType;
    }
    const bytes = Buffer.concat(chunks, length);
    return { bytes, contentType, source: ref.locator.type === "http" ? ref.locator.url : "", contentId: `k:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}` };
  }
  /** Host owns Reader/Agent lifecycle. Close removes this Reader's unique snapshot subdirectory. */
  async close(): Promise<void> {
    this.closed = true; for (const request of this.requests) request.destroy(new Error("Reader closed"));
    await Promise.allSettled([...this.streams]);
    for (const source of this.snapshots.keys()) await this.retire(source);
    if (this.directory) await rm(await this.directory, { recursive: true, force: true });
  }
}
