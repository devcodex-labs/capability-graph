import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";
import { resolveProviderRelative } from "./path-guard.js";
import { knowledgeRoot, assertKnowledgeRoot } from "./roots.js";
import { locatorSource } from "./read.js";
import type { KnowledgeReader, KnowledgeReadContext } from "./types.js";
import type { KnowledgeDocumentRef } from "../types.js";

export const contentId = (bytes: Uint8Array): string => `k:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
/** Read inside the declared root, recheck opened-file identity, and reject changed/oversized content instead of truncating it. */
export class LocalFileReader implements KnowledgeReader {
  readonly id = "local-file";
  canRead: KnowledgeReader["canRead"] = (ref) => ref.kind === "document" && ref.locator.type === "relative-file";
  async *stream(ref: KnowledgeDocumentRef, context: KnowledgeReadContext,
    options: { chunkBytes: number; signal?: AbortSignal }) {
    if (ref.locator.type !== "relative-file") throw new CapabilityGraphError("CG_READER_UNCONFIGURED", { nextAction: "configure_backend" });
    const root = knowledgeRoot({ defaultRoot: context.sourceContext.knowledgeRootDir, aliases: context.sourceContext.knowledgeRoots ?? {} }, ref.locator.root);
    if (!root) throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source" });
    const relative = ref.locator.path;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      options.signal?.throwIfAborted();
      await assertKnowledgeRoot(context.sourceContext.knowledgeRoots, ref.locator.root);
      handle = await open(await resolveProviderRelative(root, relative, true), "r");
      const before = await handle.stat({ bigint: true });
      const check = await open(await resolveProviderRelative(root, relative, true), "r");
      let verified: typeof before;
      try { verified = await check.stat({ bigint: true }); } finally { await check.close(); }
      if (!before.isFile() || before.dev !== verified.dev || before.ino !== verified.ino) throw new Error("Source changed");
      const buffer = Buffer.alloc(Math.max(1, Math.min(options.chunkBytes, Number(before.size) || 1)));
      const contentType = /\.mdx?$/i.test(path.extname(relative)) ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
      let total = 0;
      while (true) {
        options.signal?.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        yield { bytes: Uint8Array.from(buffer.subarray(0, bytesRead)), contentType, source: locatorSource(ref) };
      }
      const after = await handle.stat({ bigint: true });
      await assertKnowledgeRoot(context.sourceContext.knowledgeRoots, ref.locator.root);
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(total) !== after.size) throw new Error("Source changed");
      if (!total) yield { bytes: new Uint8Array(), contentType, source: locatorSource(ref) };
    } catch (error) {
      if (error instanceof CapabilityGraphError) throw error;
      throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { path: relative } });
    } finally { await handle?.close(); }
  }
  read: KnowledgeReader["read"] = async (ref, context, budget) => {
    if (ref.locator.type !== "relative-file") throw new CapabilityGraphError("CG_READER_UNCONFIGURED", { nextAction: "configure_backend" });
    const root = knowledgeRoot({ defaultRoot: context.sourceContext.knowledgeRootDir, aliases: context.sourceContext.knowledgeRoots ?? {} }, ref.locator.root);
    if (!root) throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source" });
    const relative = ref.locator.path;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await assertKnowledgeRoot(context.sourceContext.knowledgeRoots, ref.locator.root);
      const file = await resolveProviderRelative(root, relative, true);
      handle = await open(file, "r");
      const before = await handle.stat({ bigint: true });
      // Compare handle identities: Windows path stat can report dev=0 on Node 22.12.
      const check = await open(await resolveProviderRelative(root, relative, true), "r");
      let verified: typeof before;
      try { verified = await check.stat({ bigint: true }); } finally { await check.close(); }
      if (!before.isFile() || before.dev !== verified.dev || before.ino !== verified.ino) throw new Error("Source changed");
      if (before.size > BigInt(budget.maxBytes)) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      // One extra byte detects growth past the budget even if the initial stat was within bounds.
      const buffer = Buffer.alloc(Math.min(Number(before.size) + 1, budget.maxBytes + 1));
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > budget.maxBytes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      const after = await handle.stat({ bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(total) !== after.size) throw new Error("Source changed");
      const bytes = Uint8Array.from(buffer.subarray(0, total));
      await assertKnowledgeRoot(context.sourceContext.knowledgeRoots, ref.locator.root);
      const contentType = /\.mdx?$/i.test(path.extname(relative)) ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
      return { bytes, contentType, contentId: contentId(bytes), source: locatorSource(ref) };
    } catch (error) {
      if (error instanceof CapabilityGraphError) throw error;
      throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { path: relative } });
    } finally { await handle?.close(); }
  };
}
