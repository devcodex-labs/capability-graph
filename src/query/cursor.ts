import { createHash } from "node:crypto";
import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { inputInvalid } from "./common.js";
import type { StorePage, StorePageRequest } from "../store/types.js";

export interface CursorBinding {
  readonly kind: "catalog" | "neighbors" | "detail-knowledge" | "runtime";
  readonly staticRevision: string;
  readonly filter: unknown;
}
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
/** Bind continuation to query semantics, not authorization; base64url and the filter hash are not a signature. */
export function encodeCursor(binding: CursorBinding, after: string, runtimeRevision?: string): string {
  return Buffer.from(JSON.stringify({ v: 1, kind: binding.kind, staticRevision: binding.staticRevision,
    filterHash: hash(binding.filter), after, ...(runtimeRevision === undefined ? {} : { runtimeRevision }) })).toString("base64url");
}
/** Reject malformed cursors and changed query/revision bindings; callers must still enforce provider scope. */
export function decodeCursor(value: string | undefined, binding: CursorBinding): { after: string; runtimeRevision?: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(value)) inputInvalid();
  let cursor: Record<string, unknown>;
  try { cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; } catch { inputInvalid(); }
  if (!cursor || cursor.v !== 1 || typeof cursor.after !== "string" || typeof cursor.staticRevision !== "string" ||
      typeof cursor.filterHash !== "string" || (cursor.runtimeRevision !== undefined && typeof cursor.runtimeRevision !== "string")) inputInvalid();
  if (cursor.kind !== binding.kind || cursor.staticRevision !== binding.staticRevision || cursor.filterHash !== hash(binding.filter)) {
    throw new CapabilityGraphError("CG_REVISION_MISMATCH", { nextAction: "refresh" });
  }
  return { after: cursor.after, ...(cursor.runtimeRevision === undefined ? {} : { runtimeRevision: cursor.runtimeRevision as string }) };
}

export interface Position { readonly cursor?: string; readonly offset: number }
export function position(value?: string): Position {
  if (value === undefined) return { offset: 0 };
  let result: Position;
  try { result = JSON.parse(value) as Position; } catch { inputInvalid(); }
  if (!result || !Number.isSafeInteger(result.offset) || result.offset < 0 ||
      (result.cursor !== undefined && (typeof result.cursor !== "string" || !result.cursor))) inputInvalid();
  return result;
}

/** Resume at the page start plus consumed offset, never at an unconsumed page tail. */
export async function* walk<T>(read: (request: StorePageRequest) => Promise<StorePage<T>>, start: Position = { offset: 0 }) {
  let current = start;
  const seen = new Set<string>();
  while (true) {
    const page = await read({ limit: 100, maxBytes: 1048576, ...(current.cursor === undefined ? {} : { cursor: current.cursor }) });
    if (current.offset > page.items.length) inputInvalid();
    for (let i = current.offset; i < page.items.length; i++) {
      yield { item: page.items[i]!, before: { ...(current.cursor === undefined ? {} : { cursor: current.cursor }), offset: i } };
    }
    if (page.nextCursor === undefined) return;
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source" });
    seen.add(page.nextCursor); current = { cursor: page.nextCursor, offset: 0 };
  }
}
