import type { BudgetConfig } from "../budgets.js";
import type { QueryContext } from "../core-host.js";
import { CapabilityGraphError } from "../errors.js";
import { formatQualifiedId } from "../identity.js";
import type { CanonicalCapabilityId } from "../types.js";
import { capability, identity, inputInvalid } from "./common.js";
import type { CapabilityRef, SelectionResult } from "./types.js";

const key = (id: CanonicalCapabilityId) => formatQualifiedId(id);
const compare = (a: CanonicalCapabilityId, b: CanonicalCapabilityId) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/** Raw request size is charged before deduplication or point reads. */
export function selectionInput(selected: readonly CapabilityRef[], budgets: BudgetConfig, bound?: string): readonly CanonicalCapabilityId[] {
  if (!Array.isArray(selected) || !selected.length) inputInvalid();
  if (selected.length > budgets.selection.maxSelected) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  return selected.map((ref) => identity(ref, bound));
}

/** Traverse only validated forward requires; reasons record every direct edge, including visited targets. */
export async function resolveSelection(context: QueryContext, selected: readonly CanonicalCapabilityId[], budgets: BudgetConfig): Promise<SelectionResult> {
  const requested = [...new Map(selected.map((id) => [key(id), id])).values()];
  const requestedKeys = new Set(requested.map(key));
  const visited = new Map<string, CanonicalCapabilityId>(requested.map((id) => [key(id), id]));
  if (visited.size > budgets.selection.maxNodes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
  const reasons = new Map<string, Set<string>>();
  const edges: { from: CanonicalCapabilityId; to: CanonicalCapabilityId }[] = [];
  const queue = [...requested];
  for (let index = 0; index < queue.length; index++) {
    const node = await capability(context, queue[index]!);
    for (const target of node.requires) {
      if (target.providerId !== node.id.providerId) throw new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", { nextAction: "repair_source" });
      if (edges.length >= budgets.selection.maxEdges) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
      edges.push({ from: node.id, to: target });
      const targetKey = key(target);
      if (!reasons.has(targetKey)) reasons.set(targetKey, new Set());
      reasons.get(targetKey)!.add(key(node.id));
      if (!visited.has(targetKey)) {
        if (visited.size >= budgets.selection.maxNodes) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "page_or_filter" });
        await capability(context, target);
        visited.set(targetKey, target);
        queue.push(target);
      }
    }
  }
  const resolved = [...visited.values()].sort(compare);
  const byKey = new Map(resolved.map((id) => [key(id), id]));
  return { requested, resolved, added: resolved.filter((id) => !requestedKeys.has(key(id))),
    requiresEdges: edges.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    reasons: resolved.map((id) => ({ id, reason: { requested: requestedKeys.has(key(id)),
      requiredBy: [...(reasons.get(key(id)) ?? [])].sort().map((source) => byKey.get(source)!) } })),
    meta: { ...context.meta, budgets: { "selection.maxSelected": budgets.selection.maxSelected,
      "selection.maxNodes": budgets.selection.maxNodes, "selection.maxEdges": budgets.selection.maxEdges },
      view: { capabilities: resolved.map((id) => ({ id, staticRevision: context.graph.staticRevision(id.providerId)! })) } } };
}
