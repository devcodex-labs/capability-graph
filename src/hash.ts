import { createHash } from "node:crypto";
import { CapabilityGraphError } from "./errors.js";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderRecord } from "./store/types.js";
import type { StaticRevision } from "./types.js";

function invalidJson(): never {
  throw new CapabilityGraphError("CG_VALIDATION_FAILED", {
    nextAction: "repair_source", details: { reason: "non_json_canonical_value" },
  });
}

/** Deterministic JSON values only; never invoke a source object's toJSON/getter. */
export function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (value === null || typeof value !== "object" || ancestors.has(value)) return invalidJson();
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalidJson();
  if (Object.getOwnPropertySymbols(value).length > 0) return invalidJson();
  ancestors.add(value);
  try {
    if (array) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (!property || !Object.hasOwn(property, "value")) return invalidJson();
        items.push(canonicalJson(property.value, ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const fields: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(property, "value")) return invalidJson();
      if (property.value !== undefined) {
        fields.push(`${JSON.stringify(key)}:${canonicalJson(property.value, ancestors)}`);
      }
    }
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Hash a prevalidated, strictly ordered record stream with constant cross-record state.
 * This yields a candidate revision only; graph/source validation must finish before publication.
 * File and database authorities share these exact JSON bytes and defaults; source order is not normalized here.
 */
export async function computeStaticRevision(
  provider: UnvalidatedProviderRecord,
  capabilities: Iterable<UnvalidatedCapabilityRecord> | AsyncIterable<UnvalidatedCapabilityRecord>,
): Promise<StaticRevision> {
  const hash = createHash("sha256");
  hash.update('{"capabilities":[', "utf8");
  let previousId: string | undefined;
  for await (const capability of capabilities) {
    if (previousId !== undefined && capability.capabilityId <= previousId) {
      throw new CapabilityGraphError("CG_VALIDATION_FAILED", {
        nextAction: "repair_source", details: { reason: "capability_order_invalid" },
      });
    }
    if (previousId !== undefined) hash.update(",", "utf8");
    hash.update(canonicalJson({
      capabilityId: capability.capabilityId,
      name: capability.name,
      description: capability.description,
      whenToUse: capability.whenToUse,
      distinction: capability.distinction ?? null,
      examples: capability.examples ?? [],
      parents: capability.parents ?? [],
      specializes: capability.specializes ?? [],
      related: capability.related ?? [],
      knowledge: capability.knowledge ?? [],
    }), "utf8");
    previousId = capability.capabilityId;
  }
  hash.update('],"provider":', "utf8");
  hash.update(canonicalJson({ providerId: provider.providerId, name: provider.name,
    version: provider.version, specification: provider.specification }), "utf8");
  hash.update("}", "utf8");
  return `s:${hash.digest("hex").slice(0, 16)}`;
}
