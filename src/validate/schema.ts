import { CapabilityGraphError } from "../errors.js";
import { isId } from "../identity.js";
import type { UnvalidatedProviderRecord, UnvalidatedCapabilityRecord } from "../store/types.js";
import type { KnowledgeRef } from "../types.js";
import { knowledgeRefs, locator } from "./knowledge-ref.js";
import { array, freeze, invalid, jsonRecord, object, text } from "./values.js";

export interface CapabilityRecord extends UnvalidatedCapabilityRecord {
  readonly parents: readonly string[];
  readonly specializes: readonly string[];
  readonly related: readonly string[];
  readonly examples: readonly string[];
  readonly knowledge: readonly KnowledgeRef[];
}

function identity(value: unknown): string {
  const id = text(value);
  if (!isId(id)) throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "repair_source", details: { id } });
  return id;
}

function relations(value: unknown, relation: string): readonly string[] {
  return array(value).map((endpoint) => {
    if ((typeof endpoint === "string" && endpoint.includes("::")) ||
        (endpoint !== null && typeof endpoint === "object" && !Array.isArray(endpoint))) {
      throw new CapabilityGraphError("CG_RELATION_CROSS_PROVIDER", { nextAction: "repair_source", details: { endpoint, relation } });
    }
    if (typeof endpoint !== "string" || !isId(endpoint)) invalid({ endpoint, relation });
    return endpoint as string;
  });
}

export async function validateProvider(value: unknown, root?: string): Promise<UnvalidatedProviderRecord> {
  const raw = object(jsonRecord(value), ["providerId", "name", "version", "specification"], ["providerId", "name", "version"]);
  let specification: UnvalidatedProviderRecord["specification"];
  if (raw.specification !== undefined) {
    const spec = object(raw.specification, ["specificationId", "version", "appliesTo", "entryRef"], ["specificationId", "version"]);
    let appliesTo: NonNullable<typeof specification>["appliesTo"];
    if (spec.appliesTo !== undefined) {
      const source = object(spec.appliesTo, ["software", "versionRange", "conditions"]);
      appliesTo = Object.fromEntries(Object.entries(source).map(([key, val]) => [key, text(val)]));
    }
    specification = { specificationId: text(spec.specificationId), version: text(spec.version),
      ...(appliesTo === undefined ? {} : { appliesTo }),
      ...(spec.entryRef === undefined ? {} : { entryRef: await locator(spec.entryRef, root) }) };
  }
  return freeze({ providerId: identity(raw.providerId), name: text(raw.name), version: text(raw.version),
    ...(specification === undefined ? {} : { specification }) });
}

export async function validateCapability(value: unknown, root?: string, checkExistingPaths = true): Promise<CapabilityRecord> {
  const raw = object(jsonRecord(value), ["capabilityId", "name", "description", "whenToUse", "distinction", "examples", "parents", "specializes", "related", "knowledge"],
    ["capabilityId", "name", "description", "whenToUse"]);
  return freeze({ capabilityId: identity(raw.capabilityId), name: text(raw.name), description: text(raw.description),
    whenToUse: text(raw.whenToUse), ...(raw.distinction === undefined ? {} : { distinction: text(raw.distinction) }),
    examples: array(raw.examples === undefined ? [] : raw.examples).map(text),
    parents: relations(raw.parents === undefined ? [] : raw.parents, "parents"),
    specializes: relations(raw.specializes === undefined ? [] : raw.specializes, "specializes"),
    related: relations(raw.related === undefined ? [] : raw.related, "related"),
    knowledge: await knowledgeRefs(raw.knowledge === undefined ? [] : raw.knowledge, root, checkExistingPaths) });
}
