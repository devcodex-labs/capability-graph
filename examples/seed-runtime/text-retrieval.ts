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
  mappingRevision: string; configurationRevision: string; documents: IndexedDocument[];
}
interface Configuration { chunkBytes: number; maxDocumentBytes: number; stopWords: readonly string[] }

/** Query-bound lexical indexes. Every query rechecks exact source bytes; host invalidation rebuilds stale entries. */
export class TextKnowledgeRetriever implements KnowledgeRetriever {
  readonly id = "seed-text-knowledge";
  private readonly cache = new Map<string, Index>();
  private configuration: Configuration = { chunkBytes: 512, maxDocumentBytes: 32768, stopWords: [] };
  constructor(private readonly maxCachedSelections = 4) {
    if (!Number.isSafeInteger(maxCachedSelections) || maxCachedSelections < 1) throw new Error("Invalid cache capacity");
  }
  configure(options: Partial<Configuration>): void {
    const next = { ...this.configuration, ...options };
    if (![next.chunkBytes, next.maxDocumentBytes].every((value) => Number.isSafeInteger(value) && value > 0) ||
        next.chunkBytes < 4 || next.chunkBytes > 2048 || !Array.isArray(next.stopWords) || next.stopWords.some((value) => typeof value !== "string")) {
      throw new Error("Invalid text index configuration");
    }
    this.configuration = { ...next, stopWords: [...new Set(next.stopWords.map((value) => value.normalize("NFKC").toLowerCase()))].sort() };
  }
  private configRevision(): string { return `text:${createHash("sha256").update(JSON.stringify(this.configuration)).digest("hex").slice(0, 16)}`; }
  private indexTerms(text: string): ReadonlySet<string> {
    const ignored = new Set(this.configuration.stopWords);
    return new Set(terms(text).filter((term) => !ignored.has(term)));
  }
  private chunks(bytes: Uint8Array): Chunk[] {
    // Keep a leading BOM as a code point: offsets refer to the original bytes.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const chunks: Chunk[] = [];
    let startOffset = 0, length = 0, snippet = "";
    const flush = () => {
      if (!snippet) return;
      chunks.push({ startOffset, endOffset: startOffset + length, snippet, terms: this.indexTerms(snippet) });
      startOffset += length; length = 0; snippet = "";
    };
    for (const char of text) {
      const size = Buffer.byteLength(char, "utf8");
      if (length + size > this.configuration.chunkBytes) flush();
      snippet += char; length += size;
      if (char === "\n") flush();
    }
    flush(); return chunks;
  }
  async retrieve(input: Parameters<KnowledgeRetriever["retrieve"]>[0], access: Parameters<KnowledgeRetriever["retrieve"]>[1]): ReturnType<KnowledgeRetriever["retrieve"]> {
    if (input.targets.length > 128) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
    const selection = input.targets.map(identity).sort().join("|");
    // Sequential access avoids overflowing an injected Reader's connection limit
    // and leaves no detached reads after a failed retrieve invocation.
    const bodies: { target: (typeof input.targets)[number]; body: Awaited<ReturnType<typeof access.read>> }[] = [];
    for (const target of input.targets) bodies.push({ target,
      body: await access.read({ id: target.id, knowledgeId: target.knowledgeId }, { maxBytes: this.configuration.maxDocumentBytes }),
    });
    const configurationRevision = this.configRevision();
    let index = this.cache.get(selection);
    if (!index) {
      index = { staticRevisionByProvider: { ...input.staticRevisionByProvider }, mappingRevision: input.mappingRevision,
        configurationRevision, documents: bodies.map(({ target, body }) => ({ id: target.id, knowledgeId: target.knowledgeId,
          contentId: body.contentId, source: body.source, chunks: this.chunks(body.bytes) })) };
      if (this.cache.size >= this.maxCachedSelections) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(selection, index);
    } else { this.cache.delete(selection); this.cache.set(selection, index); }
    const wanted = [...this.indexTerms(input.text)];
    const hits: KnowledgeHit[] = index.documents.flatMap((document) => document.chunks.map((chunk) => ({
      id: document.id, knowledgeId: document.knowledgeId, contentId: document.contentId, source: document.source,
      startOffset: chunk.startOffset, endOffset: chunk.endOffset, snippet: chunk.snippet, score: score(wanted, chunk.terms),
    }))).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || identity(a).localeCompare(identity(b)) || a.startOffset - b.startOffset)
      .slice(0, input.limit);
    const indexed = new Map(index.documents.map((document) => [identity(document), document]));
    return { hits, evidence: {
      staticRevisionByProvider: index.staticRevisionByProvider, mappingRevision: index.mappingRevision,
      observedAt: new Date().toISOString(), freshness: "current", sourceConfigRevision: configurationRevision,
      indexedConfigRevision: index.configurationRevision,
      documents: bodies.map(({ target, body }) => ({ id: target.id, knowledgeId: target.knowledgeId,
        sourceContentId: body.contentId, indexedContentId: indexed.get(identity(target))!.contentId })),
    } };
  }
  async invalidate(change: SourceChange): Promise<void> {
    for (const [selection, index] of this.cache) if (change.providerId in index.staticRevisionByProvider) this.cache.delete(selection);
  }
  get cachedSelections(): number { return this.cache.size; }
}
