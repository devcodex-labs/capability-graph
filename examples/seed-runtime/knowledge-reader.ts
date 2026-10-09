import { createHash } from "node:crypto";
import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { KnowledgeReader, KnowledgeDocumentRef, KnowledgeReadContext } from "@devcodex/capability-graph";

type ReadResult = Awaited<ReturnType<KnowledgeReader["read"]>>;

/** Private HTTP reference: exact bytes, explicit origins, no redirects or pooled connections. */
export class HttpKnowledgeReader implements KnowledgeReader {
  readonly id = "seed-http-knowledge";
  private readonly origins: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly requests = new Set<ClientRequest>();
  private readonly pending = new Set<Promise<ReadResult>>();
  private closed = false;

  constructor(options: { allowedOrigins: readonly string[]; timeoutMs?: number; maxConcurrent?: number }) {
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.maxConcurrent = options.maxConcurrent ?? 4;
    if (![this.timeoutMs, this.maxConcurrent].every((value) => Number.isSafeInteger(value) && value > 0) || !options.allowedOrigins.length) {
      throw new Error("Explicit origins and positive HTTP limits are required");
    }
    this.origins = new Set(options.allowedOrigins.map((value) => {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error("Invalid origin");
      return url.origin;
    }));
  }
  get activeRequests(): number { return this.requests.size; }
  canRead(ref: Parameters<KnowledgeReader["canRead"]>[0]): boolean { return ref.kind === "document" && ref.locator.type === "http"; }
  read(ref: KnowledgeDocumentRef, _context: KnowledgeReadContext, budget: { maxBytes: number }): Promise<ReadResult> {
    const task = this.transfer(ref, budget.maxBytes);
    this.pending.add(task);
    return task.finally(() => { this.pending.delete(task); });
  }
  private async transfer(ref: KnowledgeDocumentRef, maxBytes: number): Promise<ReadResult> {
    if (this.closed || ref.locator.type !== "http" || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Reader unavailable");
    const source = ref.locator.url;
    const url = new URL(source);
    if (!this.origins.has(url.origin) || url.username || url.password || this.requests.size >= this.maxConcurrent) throw new Error("Source unavailable");
    let request: ClientRequest | undefined;
    try {
      return await new Promise<ReadResult>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let length = 0;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const fail = () => {
          if (settled) return;
          settled = true; clearTimeout(timer); request?.destroy(); reject(new Error("HTTP knowledge transfer failed"));
        };
        request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "GET", agent: false, headers: { "accept-encoding": "identity", accept: "text/plain, text/markdown" },
        }, (response) => {
          response.on("error", fail); response.on("aborted", fail);
          const encoding = response.headers["content-encoding"];
          if (response.statusCode !== 200 || (encoding && encoding !== "identity")) { fail(); response.destroy(); return; }
          const advertised = response.headers["content-length"];
          if (advertised !== undefined && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) { fail(); response.destroy(); return; }
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > maxBytes) { fail(); response.destroy(); return; }
            chunks.push(Buffer.from(chunk));
          });
          response.once("end", () => {
            if (settled) return;
            if (!response.complete) { fail(); return; }
            settled = true; clearTimeout(timer);
            const bytes = Buffer.concat(chunks, length);
            resolve({ bytes, source, contentType: response.headers["content-type"] ?? "text/plain; charset=utf-8",
              contentId: `k:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}` });
          });
        });
        this.requests.add(request);
        request.once("error", fail);
        timer = setTimeout(fail, this.timeoutMs);
        request.end();
      });
    } finally {
      if (request) {
        if (!request.closed) await new Promise<void>((resolve) => request!.once("close", resolve));
        this.requests.delete(request);
      }
    }
  }
  /** Host-owned lifecycle; Core does not close injected Readers. */
  async close(): Promise<void> {
    this.closed = true;
    for (const request of this.requests) request.destroy(new Error("Reader closed"));
    await Promise.allSettled([...this.pending]);
  }
}
