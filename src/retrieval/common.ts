import { CapabilityGraphError, type ErrorCode } from "../errors.js";
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
    if (error instanceof CapabilityGraphError && ["CG_REVISION_MISMATCH", "CG_INDEX_STALE", "CG_READER_UNCONFIGURED", "CG_READER_UNAVAILABLE", "CG_SOURCE_UNREADABLE", "CG_PATH_TRAVERSAL", "CG_BUDGET_EXCEEDED", "CG_ADAPTER_CONTRACT_INVALID", "CG_SCOPE_DENIED"].includes(error.code)) {
      throw new CapabilityGraphError(error.code, { nextAction: error.nextAction });
    }
    throw new CapabilityGraphError("CG_RETRIEVER_UNAVAILABLE", { nextAction: "repair_source" });
  }
}
