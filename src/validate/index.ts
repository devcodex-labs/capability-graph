import { computeStaticRevision } from "../hash.js";
import type { UnvalidatedProviderSnapshot, ValidatedProviderSnapshot } from "../store/types.js";
import type { StaticCapability, StaticRevision } from "../types.js";
import { validateCycles, validateEndpoints } from "./cycles.js";
import { validateKnowledgeMappings } from "./knowledge-ref.js";
import { validateCapability, validateProvider, type CapabilityRecord } from "./schema.js";
import { freeze, invalid } from "./values.js";

export function staticCapability(providerId: string, record: CapabilityRecord, staticRevision: StaticRevision): StaticCapability {
  const { capabilityId, parents, specializes, related, requires, ...fields } = record;
  const bind = (capabilityId: string) => ({ providerId, capabilityId });
  return freeze({ ...fields, id: bind(capabilityId), parents: parents.map(bind), specializes: specializes.map(bind),
    related: related.map(bind), requires: requires.map(bind), staticRevision });
}

/** Validate a complete file snapshot before publishing any part of it. */
export async function validateSnapshot(source: UnvalidatedProviderSnapshot): Promise<ValidatedProviderSnapshot> {
  const provider = await validateProvider(source.provider, source.knowledgeRootDir);
  const records = new Map<string, CapabilityRecord>();
  for (const raw of source.capabilities) {
    const record = await validateCapability(raw, source.knowledgeRootDir);
    if (records.has(record.capabilityId)) invalid({ id: record.capabilityId, reason: "duplicate_capability" });
    records.set(record.capabilityId, record);
  }
  const ids = new Set(records.keys());
  validateKnowledgeMappings([...(provider.specification ? [provider.specification.documents] : []),
    ...[...records.values()].map((record) => record.knowledge)]);
  for (const record of records.values()) validateEndpoints(record, ids);
  await validateCycles(ids, async (id) => records.get(id)!);
  const sorted = [...records.values()].sort((a, b) => a.capabilityId < b.capabilityId ? -1 : 1);
  const revision = await computeStaticRevision(provider, sorted);
  return { provider: freeze({ ...provider, authorityKind: "file" }),
    capabilities: new Map(sorted.map((record) => [record.capabilityId, staticCapability(provider.providerId, record, revision)])),
    staticRevision: revision, loadedAt: new Date().toISOString(), sourceContext: freeze({ providerId: provider.providerId,
      authorityKind: "file", sourceRevision: revision, knowledgeRootDir: source.knowledgeRootDir }) };
}
