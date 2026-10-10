import { CapabilityGraphError, projectAdapterError, type ErrorCode } from "../errors.js";
import type { QueryContext } from "../core-host.js";
import type { ResultMeta } from "../types.js";
import { inputInvalid } from "../query/common.js";

export function queryText(text: string): void { if (typeof text !== "string" || !text.trim()) inputInvalid(); }
export function revisions(context: QueryContext): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries([...context.scope].sort().flatMap((id) => {
    const revision = context.graph.staticRevision(id); return revision === undefined ? [] : [[id, revision]];
  })));
}
export function contract(reason: string): never { throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source", details: { reason } }); }
export function warning(code: ErrorCode, index: number): ResultMeta["warnings"][number] {
  return { code, message: "Adapter item rejected by Core validation.", details: { adapterIndex: index } };
}
/** Preserve captured access diagnostics by identity; never trust adapter-supplied error details. */
export async function invoke<T>(call: () => Promise<T>, accessErrors?: WeakMap<object, CapabilityGraphError>): Promise<T> {
  try { return await call(); }
  catch (error) {
    const captured = error !== null && typeof error === "object" ? accessErrors?.get(error) : undefined;
    if (captured) throw captured;
    throw projectAdapterError(error, {
      CG_REVISION_MISMATCH: "refresh", CG_INDEX_STALE: "refresh", CG_READER_UNCONFIGURED: "configure_backend",
      CG_READER_UNAVAILABLE: "repair_source", CG_SOURCE_UNREADABLE: "repair_source", CG_PATH_TRAVERSAL: "repair_source",
      CG_BUDGET_EXCEEDED: "page_or_filter", CG_ADAPTER_CONTRACT_INVALID: "repair_source", CG_SCOPE_DENIED: "narrow_scope",
    }, "CG_RETRIEVER_UNAVAILABLE", "repair_source");
  }
}
