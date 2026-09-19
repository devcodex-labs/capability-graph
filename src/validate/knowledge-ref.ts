import { CapabilityGraphError } from "../errors.js";
import { canonicalJson } from "../hash.js";
import { isKnowledgeId } from "../identity.js";
import { assertProviderRelative, resolveProviderRelative } from "../knowledge/path-guard.js";
import type { KnowledgeDocumentRef, KnowledgeLocator, KnowledgeRef } from "../types.js";
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
  const raw = object(value, ["kind", "knowledgeId", "locator"], ["kind", "knowledgeId", "locator"]);
  if (raw.kind !== "document") invalid({ reason: "document_member_required" });
  return { kind: "document", knowledgeId: knowledgeId(raw.knowledgeId), locator: await locator(raw.locator, root, checkExistingPaths) };
}

/** Resolve references only; never read document or Specification bodies. */
export async function knowledgeRefs(value: unknown, root?: string, checkExistingPaths = true): Promise<readonly KnowledgeRef[]> {
  const result: KnowledgeRef[] = [];
  const topIds = new Set<string>();
  const collectionIds = new Set<string>();
  const documents = new Map<string, string>();
  for (const entry of array(value)) {
    const raw = object(entry, ["kind", "knowledgeId", "locator", "members"], ["kind", "knowledgeId"]);
    const id = knowledgeId(raw.knowledgeId);
    if (topIds.has(id)) invalid({ knowledgeId: id, reason: "duplicate_knowledge_id" });
    topIds.add(id);
    if (raw.kind === "document") result.push(await document(raw, root, checkExistingPaths));
    else if (raw.kind === "collection") {
      object(raw, ["kind", "knowledgeId", "members"], ["members"]);
      collectionIds.add(id);
      const members: KnowledgeDocumentRef[] = [];
      for (const member of array(raw.members)) members.push(await document(member, root, checkExistingPaths));
      result.push({ kind: "collection", knowledgeId: id, members });
    } else invalid({ reason: "knowledge_kind" });
  }
  for (const reference of result) {
    for (const member of reference.kind === "document" ? [reference] : reference.members) {
      const identity = canonicalJson(member.locator);
      if (collectionIds.has(member.knowledgeId) ||
          (documents.has(member.knowledgeId) && documents.get(member.knowledgeId) !== identity)) {
        invalid({ knowledgeId: member.knowledgeId, reason: "conflicting_knowledge_id" });
      }
      documents.set(member.knowledgeId, identity);
    }
  }
  return result;
}
