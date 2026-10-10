import { createHash } from "node:crypto";
import { CapabilityGraphError, formatQualifiedId, type CapabilityGraph, type CapabilityRetriever,
  type KnowledgeRetriever, type KnowledgeHit, type KnowledgeIndexEvidence, type SourceChange,
  type CanonicalCapabilityId } from "@devcodex/capability-graph";

const terms = (text: string): string[] => [...new Set(text.normalize("NFKC").toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]/gu) ?? [])];
const identity = (value: { id: CanonicalCapabilityId; knowledgeId: string }) => `${formatQualifiedId(value.id)}::${value.knowledgeId}`;
const score = (wanted: readonly string[], indexed: ReadonlySet<string>) => wanted.filter((term) => indexed.has(term)).length;

/** Deterministic lexical recall over a revision-bound public Catalog snapshot. */
export class TextCapabilityRetriever implements CapabilityRetriever {
  readonly id = "seed-text-capabilities";
  private revisions: Record<string, string> = {};
  private rows: { id: CanonicalCapabilityId; terms: ReadonlySet<string> }[] = [];
  constructor(private readonly maxCapabilities = 10000) {
    if (!Number.isSafeInteger(maxCapabilities) || maxCapabilities < 1) throw new Error("Invalid index capacity");
  }
  async rebuild(graph: CapabilityGraph): Promise<void> {
    const revisions: Record<string, string> = {};
    const rows: typeof this.rows = [];
    const providers = await graph.listProviders();
    for (const provider of providers.items) {
      const bound = graph.forProvider(provider.providerId);
      const revision = (await bound.getProvider()).staticRevision;
      revisions[provider.providerId] = revision;
      let cursor: string | undefined;
      do {
        const page = await bound.listCatalog({ requiredStaticRevision: revision, limit: 100, ...(cursor ? { cursor } : {}) });
        if (page.meta.warnings.length || page.meta.completeness === "partial" ||
            (page.meta.completeness !== "complete" && !page.nextCursor)) throw new Error("Catalog snapshot incomplete");
        for (const item of page.items) {
          if (rows.length >= this.maxCapabilities) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
          rows.push({ id: item.id, terms: new Set(terms([item.name, item.description, item.whenToUse, item.distinction].filter(Boolean).join(" "))) });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    this.rows = rows; this.revisions = revisions;
  }
  async retrieve(input: Parameters<CapabilityRetriever["retrieve"]>[0]): ReturnType<CapabilityRetriever["retrieve"]> {
    if (input.providerIds.some((provider) => this.revisions[provider] !== input.staticRevisionByProvider[provider])) {
      throw new CapabilityGraphError("CG_INDEX_STALE", { nextAction: "refresh" });
    }
    const wanted = terms(input.text);
    const allowed = new Set(input.providerIds);
    const candidates = this.rows.filter((row) => allowed.has(row.id.providerId)).map((row) => ({ row, score: score(wanted, row.terms) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || formatQualifiedId(a.row.id).localeCompare(formatQualifiedId(b.row.id)))
      .slice(0, input.limit).map(({ row, score }) => ({ id: row.id, score, sourceStaticRevision: this.revisions[row.id.providerId]! }));
    return { candidates };
  }
  async invalidate(change: SourceChange): Promise<void> { delete this.revisions[change.providerId]; }
}

interface Chunk { startOffset: number; endOffset: number; snippet: string; terms: ReadonlySet<string> }
interface IndexedDocument { id: CanonicalCapabilityId; knowledgeId: string; contentId: string; source: string; chunks: Chunk[] }
interface Index {
  staticRevisionByProvider: KnowledgeIndexEvidence["staticRevisionByProvider"];
  mappingRevision: string; configurationRevision: string; documents: IndexedDocument[]; bytes: number; entries: number;
}
interface Configuration { chunkBytes: number; maxDocumentBytes: number; stopWords: readonly string[]; maxCachedBytes: number; maxCachedEntries: number }

/** Query-bound lexical indexes. Every query rechecks exact source bytes; host invalidation rebuilds stale entries. */
export class TextKnowledgeRetriever implements KnowledgeRetriever {
  readonly id = "seed-text-knowledge";
  private readonly cache = new Map<string, Index>();
  private readonly pending = new Set<{ providers: ReadonlySet<string>; invalidated: boolean }>();
  private configuration: Configuration = { chunkBytes: 512, maxDocumentBytes: 32768, stopWords: [], maxCachedBytes: 8_388_608, maxCachedEntries: 10_000 };
  constructor(private readonly maxCachedSelections = 4) {
    if (!Number.isSafeInteger(maxCachedSelections) || maxCachedSelections < 1) throw new Error("Invalid cache capacity");
  }
  /** pageBytes controls scan chunk size, not total document admission. maxDocumentBytes is a legacy alias. */
  configure(options: Partial<Configuration> & { pageBytes?: number }): void {
    if (options.pageBytes !== undefined && options.maxDocumentBytes !== undefined && options.pageBytes !== options.maxDocumentBytes) throw new Error("Conflicting page sizes");
    const { pageBytes, ...legacy } = options;
    const next = { ...this.configuration, ...legacy, ...(pageBytes === undefined ? {} : { maxDocumentBytes: pageBytes }) };
    if (![next.chunkBytes, next.maxDocumentBytes, next.maxCachedBytes, next.maxCachedEntries].every((value) => Number.isSafeInteger(value) && value > 0) ||
        next.chunkBytes < 4 || next.chunkBytes > 2048 || !Array.isArray(next.stopWords) || next.stopWords.some((value) => typeof value !== "string")) {
      throw new Error("Invalid text index configuration");
    }
    this.configuration = { ...next, stopWords: [...new Set(next.stopWords.map((value) => value.normalize("NFKC").toLowerCase()))].sort() };
    while (this.cachedBytes > next.maxCachedBytes || this.cachedEntries > next.maxCachedEntries) this.cache.delete(this.cache.keys().next().value!);
  }
  private configRevision(configuration: Configuration): string { return `text:${createHash("sha256").update(JSON.stringify(configuration)).digest("hex").slice(0, 16)}`; }
  private indexTerms(text: string, configuration: Configuration): ReadonlySet<string> {
    const ignored = new Set(configuration.stopWords);
    return new Set(terms(text).filter((term) => !ignored.has(term)));
  }
  private chunks(bytes: Uint8Array, configuration: Configuration): Chunk[] {
    // Keep a leading BOM as a code point: offsets refer to the original bytes.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const chunks: Chunk[] = [];
    let startOffset = 0, length = 0, snippet = "";
    const flush = () => {
      if (!snippet) return;
      chunks.push({ startOffset, endOffset: startOffset + length, snippet, terms: this.indexTerms(snippet, configuration) });
      startOffset += length; length = 0; snippet = "";
    };
    for (const char of text) {
      const size = Buffer.byteLength(char, "utf8");
      if (length + size > configuration.chunkBytes) flush();
      snippet += char; length += size;
      if (char === "\n") flush();
    }
    flush(); return chunks;
  }
  async retrieve(input: Parameters<KnowledgeRetriever["retrieve"]>[0], access: Parameters<KnowledgeRetriever["retrieve"]>[1]): ReturnType<KnowledgeRetriever["retrieve"]> {
    if (input.targets.length > 128) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
    const selection = input.targets.map(identity).sort().join("|");
    const configuration = this.configuration;
    const configurationRevision = this.configRevision(configuration);
    const cached = this.cache.get(selection);
    const invocation = { providers: new Set(Object.keys(input.staticRevisionByProvider)), invalidated: false };
    this.pending.add(invocation);
    try {
      // Sequential access avoids overflowing an injected Reader's connection limit
      // and leaves no detached reads after a failed retrieve invocation.
      const bodies: { target: (typeof input.targets)[number]; body: { contentId: string; source: string }; chunks: Chunk[] }[] = [];
      const wanted = [...this.indexTerms(input.text, configuration)];
      const best: { target: Pick<(typeof input.targets)[number], "id" | "knowledgeId">; chunk: Chunk; score: number }[] = [];
      let retainedBytes = 0; let retainedEntries = 0; let retain = !cached;
      const consider = (target: Pick<(typeof input.targets)[number], "id" | "knowledgeId">, chunk: Chunk, chunks: Chunk[]) => {
        const value = score(wanted, chunk.terms);
        if (value > 0) {
          best.push({ target, chunk, score: value });
          best.sort((a, b) => b.score - a.score || identity(a.target).localeCompare(identity(b.target)) || a.chunk.startOffset - b.chunk.startOffset);
          if (best.length > input.limit) best.pop();
        }
        if (retain) {
          retainedBytes += 128 + Buffer.byteLength(chunk.snippet) + [...chunk.terms].reduce((sum, term) => sum + 48 + Buffer.byteLength(term), 0);
          retainedEntries++;
          if (retainedBytes > configuration.maxCachedBytes || retainedEntries > configuration.maxCachedEntries) {
            retain = false; for (const body of bodies) body.chunks.length = 0; chunks.length = 0;
          } else chunks.push(chunk);
        }
      };
      for (const target of input.targets) {
        if (retain) {
          retainedBytes += 256 + Buffer.byteLength(identity(target));
          if (retainedBytes > configuration.maxCachedBytes) { retain = false; for (const body of bodies) body.chunks.length = 0; }
        }
        if (access.scan && configuration.maxDocumentBytes >= 4) {
          const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
          const chunks: Chunk[] = []; let pendingText = ""; let offset = 0;
          const flush = (final: boolean) => {
            // Keep only one unfinished chunk. Do not retain full document bytes.
            while (pendingText && (final || Buffer.byteLength(pendingText) >= configuration.chunkBytes)) {
              let snippet = ""; let length = 0;
              for (const char of pendingText) {
                const size = Buffer.byteLength(char);
                if (length + size > configuration.chunkBytes) break;
                snippet += char; length += size;
                if (char === "\n") break;
              }
              consider(target, { startOffset: offset, endOffset: offset + length, snippet, terms: this.indexTerms(snippet, configuration) }, chunks);
              offset += length; pendingText = pendingText.slice(snippet.length);
            }
          };
          const body = await access.scan({ id: target.id, knowledgeId: target.knowledgeId }, (bytes) => {
            // A cached index needs a fresh content identity, not a second copy of its chunks.
            if (!cached) { pendingText += decoder.decode(bytes, { stream: true }); flush(false); }
          }, { chunkBytes: configuration.maxDocumentBytes });
          if (!cached) { pendingText += decoder.decode(); flush(true); }
          bodies.push({ target, body, chunks });
        } else {
          const body = await access.read({ id: target.id, knowledgeId: target.knowledgeId }, { maxBytes: configuration.maxDocumentBytes });
          const chunks: Chunk[] = [];
          if (!cached) for (const chunk of this.chunks(body.bytes, configuration)) consider(target, chunk, chunks);
          bodies.push({ target, body, chunks });
        }
      }
      let index = cached;
      if (!index) {
        index = { staticRevisionByProvider: { ...input.staticRevisionByProvider }, mappingRevision: input.mappingRevision,
          configurationRevision, bytes: retainedBytes, entries: retainedEntries, documents: bodies.map(({ target, body, chunks }) => ({ id: target.id, knowledgeId: target.knowledgeId,
            contentId: body.contentId, source: body.source, chunks })) };
      }
      // An old request may finish its snapshot, but cannot republish after host
      // invalidation or configure(). Only active invocations retain these tokens.
      if ((cached || retain) && !invocation.invalidated && configuration === this.configuration) {
        this.cache.delete(selection);
        while (this.cache.size && (this.cache.size >= this.maxCachedSelections || this.cachedBytes + index.bytes > configuration.maxCachedBytes || this.cachedEntries + index.entries > configuration.maxCachedEntries)) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(selection, index);
      }
      const indexed = new Map(index.documents.map((document) => [identity(document), document]));
      if (cached) for (const document of index.documents) for (const chunk of document.chunks) consider(document, chunk, []);
      const hits: KnowledgeHit[] = best.map(({ target, chunk, score }) => ({ id: target.id, knowledgeId: target.knowledgeId,
        contentId: indexed.get(identity(target))!.contentId, source: indexed.get(identity(target))!.source,
        startOffset: chunk.startOffset, endOffset: chunk.endOffset, snippet: chunk.snippet, score }));
      return { hits, evidence: {
        staticRevisionByProvider: index.staticRevisionByProvider, mappingRevision: index.mappingRevision,
        observedAt: new Date().toISOString(), freshness: "current", sourceConfigRevision: configurationRevision,
        indexedConfigRevision: index.configurationRevision,
        documents: bodies.map(({ target, body }) => ({ id: target.id, knowledgeId: target.knowledgeId,
          sourceContentId: body.contentId, indexedContentId: indexed.get(identity(target))!.contentId })),
      } };
    } finally { this.pending.delete(invocation); }
  }
  async invalidate(change: SourceChange): Promise<void> {
    for (const invocation of this.pending) if (invocation.providers.has(change.providerId)) invocation.invalidated = true;
    for (const [selection, index] of this.cache) if (change.providerId in index.staticRevisionByProvider) this.cache.delete(selection);
  }
  get cachedSelections(): number { return this.cache.size; }
  /** Conservative accounted payload/object bytes, not a measurement of JavaScript heap usage. */
  get cachedBytes(): number { return [...this.cache.values()].reduce((sum, index) => sum + index.bytes, 0); }
  get cachedEntries(): number { return [...this.cache.values()].reduce((sum, index) => sum + index.entries, 0); }
}
