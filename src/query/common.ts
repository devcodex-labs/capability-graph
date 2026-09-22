import { CapabilityGraphError } from "../errors.js";
import { formatQualifiedId, isId } from "../identity.js";
import type { QueryContext } from "../core-host.js";
import type { CanonicalCapabilityId, NeighborKind, StaticCapability } from "../types.js";
import type { CapabilityRef, CatalogRecord } from "./types.js";

export const KINDS: readonly NeighborKind[] = ["parents", "children", "specializes", "specializedBy", "related", "relatedBy", "requires", "requiredBy"];
export const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
export function inputInvalid(): never { throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" }); }
export function limit(value: number | undefined, fallback: number, maximum: number, zero = false): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < (zero ? 0 : 1)) inputInvalid();
  return Math.min(result, maximum);
}
export function identity(ref: CapabilityRef, bound?: string): CanonicalCapabilityId {
  if (!ref || typeof ref !== "object" || !isId(ref.capabilityId)) throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
  const providerId = "providerId" in ref ? ref.providerId : bound;
  if (providerId === undefined) throw new CapabilityGraphError("CG_IDENTITY_AMBIGUOUS", { nextAction: "fix_input" });
  if (!isId(providerId)) throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
  if (bound !== undefined && bound !== providerId) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  return { providerId, capabilityId: ref.capabilityId };
}
export async function capability(context: QueryContext, ref: CapabilityRef, bound?: string): Promise<StaticCapability> {
  const id = identity(ref, bound);
  if (!context.scope.has(id.providerId)) throw new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" });
  const result = await context.graph.getView(id.providerId)?.getCapability(id.capabilityId);
  if (!result) throw new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" });
  return result;
}
export function catalogRecord(node: StaticCapability): CatalogRecord {
  return { id: node.id, qualifiedId: formatQualifiedId(node.id), providerId: node.id.providerId,
    name: node.name, description: node.description, whenToUse: node.whenToUse, staticRevision: node.staticRevision,
    ...(node.distinction === undefined ? {} : { distinction: node.distinction }) };
}
