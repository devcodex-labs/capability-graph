import { createRequire } from "node:module";
import { parse, stringify, type Schema } from "bcp-47";
import { CapabilityGraphError } from "./errors.js";

const require = createRequire(import.meta.url);
const base = "language-subtag-registry/data/json/";
type RegistryRecord = { readonly "Preferred-Value"?: string; readonly Prefix?: readonly string[]; readonly Tag?: string };
const registry = require(`${base}registry.json`) as readonly RegistryRecord[];
const indices = Object.fromEntries((["language", "extlang", "script", "region", "variant", "grandfathered"] as const)
  .map((type) => [type, Object.fromEntries(Object.entries(require(`${base}${type}.json`) as Record<string, number>)
    .map(([key, index]) => [key.toLowerCase(), index]))])) as
  Record<"language" | "extlang" | "script" | "region" | "variant" | "grandfathered", Record<string, number>>;

function invalid(value: unknown): never {
  throw new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input", details: { field: "locale", value } });
}

function registered(type: keyof typeof indices, subtag: string): RegistryRecord | undefined {
  const key = subtag.toLowerCase();
  const index = indices[type][key];
  if (index !== undefined) return registry[index];
  if (type === "language" && /^q[a-t][a-z]$/.test(key)) return {};
  if (type === "script" && /^qa(?:a[a-z]|b[a-x])$/.test(key)) return {};
  if (type === "region" && /^(?:q[m-z]|x[a-z])$/.test(key)) return {};
  return undefined;
}

function preferred(type: keyof typeof indices, subtag: string): string {
  return registered(type, subtag)?.["Preferred-Value"] ?? subtag;
}

function validate(schema: Schema, original: string): void {
  if (schema.irregular || schema.regular) {
    if (!registered("grandfathered", original)) invalid(original);
    return;
  }
  if (!schema.language) {
    if (!schema.privateuse.length) invalid(original);
    return;
  }
  if (!registered("language", schema.language)) invalid(original);
  let prefix = schema.language;
  for (const extlang of schema.extendedLanguageSubtags) {
    const entry = registered("extlang", extlang);
    if (!entry || (entry.Prefix && !entry.Prefix.some((candidate) => candidate.toLowerCase() === prefix.toLowerCase()))) invalid(original);
    prefix += `-${extlang}`;
  }
  if (schema.script && !registered("script", schema.script)) invalid(original);
  if (schema.region && !registered("region", schema.region)) invalid(original);
  const variants = new Set<string>();
  let variantPrefix = [schema.language, ...schema.extendedLanguageSubtags, schema.script, schema.region].filter(Boolean).join("-");
  for (const variant of schema.variants) {
    const key = variant.toLowerCase();
    const entry = registered("variant", key);
    if (!entry || variants.has(key)) invalid(original);
    if (entry.Prefix && !entry.Prefix.some((candidate) => {
      const prefix = candidate.toLowerCase(); const current = variantPrefix.toLowerCase();
      return current === prefix || current.startsWith(`${prefix}-`);
    })) invalid(original);
    variants.add(key);
    variantPrefix += `-${variant}`;
  }
  const singletons = new Set<string>();
  for (const extension of schema.extensions) {
    const key = extension.singleton.toLowerCase();
    if (singletons.has(key)) invalid(original);
    singletons.add(key);
  }
}

/** Normalize against the pinned IANA registry snapshot, independent of the host ICU version. */
export function normalizeLocale(value: unknown): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 128) invalid(value);
  let tag = value as string;
  for (let pass = 0; pass < 4; pass++) {
    let warning = false;
    const parsed = parse(tag, { normalize: false, warning: () => { warning = true; return undefined; } });
    if (warning || !stringify(parsed)) invalid(value);
    validate(parsed, tag);
    if (parsed.irregular || parsed.regular) {
      const replacement = registered("grandfathered", tag)?.["Preferred-Value"];
      if (replacement) { tag = replacement; continue; }
      return registered("grandfathered", tag)?.Tag ?? stringify(parsed);
    }
    if (parsed.language) {
      const language = preferred("language", parsed.language);
      parsed.language = language.toLowerCase();
      if (parsed.extendedLanguageSubtags.length === 1) {
        const extlang = parsed.extendedLanguageSubtags[0]!;
        const replacement = registered("extlang", extlang)?.["Preferred-Value"];
        if (replacement) { parsed.language = replacement.toLowerCase(); parsed.extendedLanguageSubtags = []; }
      }
      parsed.extendedLanguageSubtags = parsed.extendedLanguageSubtags.map((subtag) => subtag.toLowerCase());
      if (parsed.script) { const script = preferred("script", parsed.script).toLowerCase(); parsed.script = script[0]!.toUpperCase() + script.slice(1); }
      if (parsed.region) parsed.region = preferred("region", parsed.region).toUpperCase();
      parsed.variants = parsed.variants.map((variant) => preferred("variant", variant).toLowerCase());
      parsed.extensions = parsed.extensions.map((extension) => ({ singleton: extension.singleton.toLowerCase(),
        extensions: extension.extensions.map((part) => part.toLowerCase()) }));
      parsed.extensions.sort((a, b) => a.singleton.toLowerCase().localeCompare(b.singleton.toLowerCase()));
    }
    parsed.privateuse = parsed.privateuse.map((part) => part.toLowerCase());
    const normalized = stringify(parsed);
    if (Buffer.byteLength(normalized, "utf8") > 128) invalid(value);
    return normalized;
  }
  return invalid(value);
}
