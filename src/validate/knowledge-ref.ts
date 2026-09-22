import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { isKnowledgeId } from "../identity.js";
import { normalizeLocale } from "../locale.js";
import { assertProviderRelative, resolveProviderRelative } from "../knowledge/path-guard.js";
import type { KnowledgeCollectionRef, KnowledgeDocumentRef, KnowledgeLocator, KnowledgeRef } from "../types.js";
import { array, invalid, object, text } from "./values.js";

function knowledgeId(value: unknown): string {
  const id = text(value);
  if (!isKnowledgeId(id)) throw new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "repair_source", details: { id } });
  return id;
}

export async function locator(value: unknown, root?: string, checkExistingPaths = true): Promise<KnowledgeLocator> {
  const raw = object(value, ["type", "path", "url"], ["type"]);
  if (raw.type === "relative-file") {
    object(raw, ["type", "path"], ["path"]);
    if (typeof raw.path !== "string") invalid({ reason: "path_string_required" });
    const relative = raw.path as string;
    assertProviderRelative(relative);
    if (!root) invalid({ reason: "relative_file_requires_knowledge_root" });
    if (checkExistingPaths) await resolveProviderRelative(root, relative);
    return { type: "relative-file", path: relative };
  }
  if (raw.type === "http") {
    object(raw, ["type", "url"], ["url"]);
    const url = text(raw.url);
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) invalid({ reason: "http_url_required" }); }
    catch { invalid({ reason: "http_url_required" }); }
    return { type: "http", url };
  }
  return invalid({ reason: "locator_type" });
}

async function document(value: unknown, root?: string, checkExistingPaths = true): Promise<KnowledgeDocumentRef> {
  const raw = object(value, ["kind", "knowledgeId", "locator", "role", "locale", "title", "summary", "canonicalUrl"],
    ["kind", "knowledgeId", "locator", "role"]);
  if (raw.kind !== "document") invalid({ reason: "document_member_required" });
  const role = text(raw.role);
  if (!isKnowledgeId(role) || role.length > 128) invalid({ field: "role", reason: "role_required" });
  const optional = (field: "title" | "summary", maxBytes: number) => {
    if (raw[field] === undefined) return undefined;
    const value = text(raw[field]);
    if (Buffer.byteLength(value, "utf8") > maxBytes) invalid({ field, reason: "too_long" });
    return value;
  };
  let canonicalUrl: string | undefined;
  if (raw.canonicalUrl !== undefined) {
    const input = text(raw.canonicalUrl);
    if (Buffer.byteLength(input, "utf8") > 2_048) invalid({ field: "canonicalUrl", reason: "too_long" });
    try { const url = new URL(input); if (!["http:", "https:"].includes(url.protocol) || url.href !== input) invalid({ field: "canonicalUrl" }); canonicalUrl = url.href; }
    catch { invalid({ field: "canonicalUrl" }); }
  }
  let locale: string | undefined;
  if (raw.locale !== undefined) {
    try { locale = normalizeLocale(raw.locale); }
    catch { invalid({ field: "locale", reason: "invalid_locale" }); }
  }
  return { kind: "document", knowledgeId: knowledgeId(raw.knowledgeId), locator: await locator(raw.locator, root, checkExistingPaths), role,
    ...(locale === undefined ? {} : { locale }), ...(raw.title === undefined ? {} : { title: optional("title", 256) }),
    ...(raw.summary === undefined ? {} : { summary: optional("summary", 2_048) }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }) };
}

export async function specificationDocuments(value: unknown, root?: string, checkExistingPaths = true): Promise<readonly KnowledgeDocumentRef[]> {
  const ids = new Set<string>();
  const result: KnowledgeDocumentRef[] = [];
  for (const entry of array(value)) {
    const ref = await document(entry, root, checkExistingPaths);
    if (ref.role !== "specification" || ids.has(ref.knowledgeId)) invalid({ knowledgeId: ref.knowledgeId, reason: "specification_document_invalid" });
    ids.add(ref.knowledgeId); result.push(ref);
  }
  if (!result.length) invalid({ field: "specification.documents", reason: "documents_required" });
  return result.sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId));
}

function identity(ref: KnowledgeRef): string {
  if (ref.kind === "document") return canonicalJson(ref);
  return canonicalJson({ ...ref, members: [...ref.members].sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId)) });
}

/** Cross-capability and Specification identity is provider-owned, not local to one record. */
export function createKnowledgeMappingValidator(): (refs: readonly KnowledgeRef[]) => void {
  const known = new Map<string, string>();
  return (refs) => { for (const ref of refs) {
    for (const item of ref.kind === "document" ? [ref] : [ref, ...ref.members]) {
      const key = createHash("sha256").update(identity(item)).digest("hex");
      if (known.has(item.knowledgeId) && known.get(item.knowledgeId) !== key) {
        invalid({ knowledgeId: item.knowledgeId, reason: "conflicting_knowledge_id" });
      }
      known.set(item.knowledgeId, key);
    }
  } };
}

export function validateKnowledgeMappings(groups: Iterable<readonly KnowledgeRef[]>): void {
  const accept = createKnowledgeMappingValidator();
  for (const group of groups) accept(group);
}

/** Resolve references only; never read document or Specification bodies. */
export async function knowledgeRefs(value: unknown, root?: string, checkExistingPaths = true): Promise<readonly KnowledgeRef[]> {
  const result: KnowledgeRef[] = [];
  const topIds = new Set<string>();
  const collectionIds = new Set<string>();
  const documents = new Map<string, string>();
  for (const entry of array(value)) {
    const raw = object(entry, ["kind", "knowledgeId", "locator", "members", "role", "locale", "title", "summary", "canonicalUrl"], ["kind", "knowledgeId"]);
    const id = knowledgeId(raw.knowledgeId);
    if (topIds.has(id)) invalid({ knowledgeId: id, reason: "duplicate_knowledge_id" });
    topIds.add(id);
    if (raw.kind === "document") result.push(await document(raw, root, checkExistingPaths));
    else if (raw.kind === "collection") {
      object(raw, ["kind", "knowledgeId", "members", "title", "summary"], ["members"]);
      collectionIds.add(id);
      const members: KnowledgeDocumentRef[] = [];
      const memberIds = new Set<string>();
      for (const member of array(raw.members)) {
        const ref = await document(member, root, checkExistingPaths);
        if (memberIds.has(ref.knowledgeId)) invalid({ knowledgeId: ref.knowledgeId, reason: "duplicate_collection_member" });
        memberIds.add(ref.knowledgeId); members.push(ref);
      }
      const optional = (field: "title" | "summary", maxBytes: number) => {
        if (raw[field] === undefined) return {};
        const value = text(raw[field]);
        if (Buffer.byteLength(value, "utf8") > maxBytes) invalid({ field, reason: "too_long" });
        return { [field]: value };
      };
      result.push({ kind: "collection", knowledgeId: id, ...optional("title", 256), ...optional("summary", 2_048),
        members: members.sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId)) } as KnowledgeCollectionRef);
    } else invalid({ reason: "knowledge_kind" });
  }
  for (const reference of result) {
    for (const member of reference.kind === "document" ? [reference] : reference.members) {
      const mapped = identity(member);
      if (collectionIds.has(member.knowledgeId) ||
          (documents.has(member.knowledgeId) && documents.get(member.knowledgeId) !== mapped)) {
        invalid({ knowledgeId: member.knowledgeId, reason: "conflicting_knowledge_id" });
      }
      documents.set(member.knowledgeId, mapped);
    }
  }
  return result.sort((a, b) => a.knowledgeId.localeCompare(b.knowledgeId));
}
import { createHash } from "node:crypto";
