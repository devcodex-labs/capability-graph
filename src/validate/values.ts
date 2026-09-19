import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";

export const RECORD_MAX_BYTES = 262_144;

/** Shared field validation for JSON files and database records. */
export function invalid(details: Record<string, unknown> = {}): never {
  throw new CapabilityGraphError("CG_VALIDATION_FAILED", { nextAction: "repair_source", details });
}

export function object(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid({ reason: "object_required" });
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => !allowed.includes(key));
  if (keys.length) invalid({ keys });
  const missing = required.filter((key) => !Object.hasOwn(record, key));
  if (missing.length) invalid({ reason: "required_fields", keys: missing });
  return record;
}

export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid({ reason: "nonempty_string_required" });
  return value as string;
}

export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid({ reason: "array_required" });
  return value;
}

/** Snapshot source data so later caller mutations cannot modify validated definitions. */
export function jsonRecord(value: unknown): unknown {
  const json = canonicalJson(value);
  if (Buffer.byteLength(json, "utf8") > RECORD_MAX_BYTES) {
    throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", { nextAction: "repair_source", details: { maxBytes: RECORD_MAX_BYTES } });
  }
  return JSON.parse(json) as unknown;
}

export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
