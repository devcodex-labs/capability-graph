import { CapabilityGraphError } from "./errors.js";
import type { CanonicalCapabilityId, QualifiedCapabilityId } from "./types.js";

export const QUALIFIED_SEPARATOR = "::" as const;
export const ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
export const KNOWLEDGE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

/** Validate ASCII provider/capability IDs without coercing caller objects. */
export function isId(value: string): boolean {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Knowledge IDs also permit uppercase letters, such as D-02. */
export function isKnowledgeId(value: string): boolean {
  return typeof value === "string" && KNOWLEDGE_ID_PATTERN.test(value);
}

/** Internal primitive for the later bound Provider query facade. */
export function bindCapabilityId(providerId: string, capabilityId: string): CanonicalCapabilityId {
  if (!isId(providerId) || !isId(capabilityId)) {
    throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
  }
  return { providerId, capabilityId };
}

/** Format the reversible display ID; invalid fields never produce a key. */
export function formatQualifiedId(id: CanonicalCapabilityId): QualifiedCapabilityId {
  if (id === null || typeof id !== "object") {
    throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
  }
  const valid = bindCapabilityId(id.providerId, id.capabilityId);
  return `${valid.providerId}${QUALIFIED_SEPARATOR}${valid.capabilityId}`;
}

/** Wrapper-only decoding; dots do not reveal a provider boundary. */
export function parseQualifiedId(value: string): CanonicalCapabilityId {
  if (typeof value !== "string") {
    throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input" });
  }
  const index = value.indexOf(QUALIFIED_SEPARATOR);
  if (index <= 0 || value.indexOf(QUALIFIED_SEPARATOR, index + 2) !== -1) {
    throw new CapabilityGraphError("CG_IDENTITY_AMBIGUOUS", {
      nextAction: "fix_input",
      message: "Qualified ID must use exactly one '::' separator",
    });
  }
  return bindCapabilityId(value.slice(0, index), value.slice(index + 2));
}

/** Compare logical fields, never provider versions or display prefixes. */
export function equalId(a: CanonicalCapabilityId, b: CanonicalCapabilityId): boolean {
  return a.providerId === b.providerId && a.capabilityId === b.capabilityId;
}

/** Use the reversible encoding for maps; it introduces no second identity. */
export function idKey(id: CanonicalCapabilityId): string {
  return formatQualifiedId(id);
}
