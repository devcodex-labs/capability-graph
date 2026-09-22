import { CapabilityGraphError, formatQualifiedId, parseQualifiedId,
  type CanonicalCapabilityId, type BudgetConfig, type BudgetOverrides,
  type ErrorShape, type BatchItem, type BatchResult, type ProviderResult, type NeighborPage } from "@devcodex/capability-graph";

const id: CanonicalCapabilityId = { providerId: "seed.http", capabilityId: "route.http" };
const encoded: string = formatQualifiedId(id);
const decoded: CanonicalCapabilityId = parseQualifiedId(encoded);
const override: BudgetOverrides = { catalog: { maxBytes: 8_192 }, neighbors: { maxBytes: 8_192, maxItemBytes: 1_024 }, runtime: { timeoutMs: 100 } };
const error: ErrorShape = new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" });
const batch: BatchResult<string> = { results: [{ inputIndex: 0, ok: false, error }], meta: {
  completeness: "partial", compositeStaticRevision: "s:1", servedFrom: "current", scope: ["seed.http"], warnings: [],
} };

function narrow(item: BatchItem<string>, budgets: BudgetConfig): number {
  if (item.ok) item.value.toUpperCase();
  else item.error.nextAction.toUpperCase();
  return budgets.catalog.maxBytes;
}
void [decoded, override, batch, narrow];

// @ts-expect-error Provider identity cannot be omitted from the default path.
const missingProvider: CanonicalCapabilityId = { capabilityId: "route.http" };
// @ts-expect-error Qualified strings are not CanonicalCapabilityId objects.
formatQualifiedId("seed.http::route.http");
// @ts-expect-error Unknown budget fields must fail in independent consumer code.
const unknownBudget: BudgetOverrides = { catalog: { bytes: 10 } };
// @ts-expect-error Configuration budgets require numeric values.
const badBudget: BudgetOverrides = { read: { maxBytes: "10" } };
// @ts-expect-error A successful item requires a value.
const badBatch: BatchItem<string> = { inputIndex: 0, ok: true };
// @ts-expect-error Error codes are a closed contract.
new CapabilityGraphError("CG_MADE_UP", { nextAction: "fix_input" });
// @ts-expect-error Next actions are a closed contract.
new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "retry_anything" });
// @ts-expect-error Logical identity fields are readonly.
id.providerId = "other";
// @ts-expect-error Internal hash implementation is not a public export.
import { computeStaticRevision } from "@devcodex/capability-graph";
// @ts-expect-error Internal configuration normalization is not a public export.
import { resolveBudgets } from "@devcodex/capability-graph";
// @ts-expect-error No public MCP package subpath is provided.
import {} from "@devcodex/capability-graph/mcp";
// Raw records are intentionally public inputs to the database adapter contract.
import type { UnvalidatedCapabilityRecord } from "@devcodex/capability-graph";
// @ts-expect-error Validated internal graph nodes are not the public bounded detail projection.
import type { StaticCapability } from "@devcodex/capability-graph";
import type { BoundProviderGraph, CapabilityDetail, KnowledgeDocumentRef, SelectionResult,
  UnvalidatedProviderRecord } from "@devcodex/capability-graph";
function graphConsumer(bound: BoundProviderGraph, detail: CapabilityDetail, raw: UnvalidatedCapabilityRecord, neighbors: NeighborPage) {
  const provider: Promise<ProviderResult> = bound.getProvider();
  void provider.then((value) => [value.staticRevision, value.meta.servedFrom, value.meta.refreshFailed]);
  const completeness: "complete" | "truncated" | "partial" = neighbors.groups.children.completeness;
  void completeness;
  void bound.listCatalog({ limit: 2 });
  const selection: Promise<SelectionResult> = bound.resolveSelection({ selected: ["route.validation"] });
  void selection.then((value) => [value.resolved, value.requiresEdges, value.reasons, value.meta.servedFromByProvider]);
  void bound.listKnowledgeMembers({ capabilityId: "route.validation", collectionId: "examples", limit: 20 });
  void bound.listSpecificationDocuments({ limit: 20 });
  void bound.readSpecification({ knowledgeIds: ["SPEC-01"], locales: ["zh-CN"] });
  void bound.readDocuments({ selected: ["route.validation"], roles: ["guide"], locales: ["zh-CN"] });
  // @ts-expect-error Bound calls cannot override provider scope.
  void bound.listCatalog({ requestProviderScope: ["other"] });
  // @ts-expect-error Detail does not expose internal full adjacency lists.
  void detail.parents;
  void raw.capabilityId;
}
void graphConsumer;
const document: KnowledgeDocumentRef = { kind: "document", knowledgeId: "guide", role: "guide",
  locator: { type: "http", url: "https://example.test/guide" } };
// @ts-expect-error v1.0.1 requires a role on every Document.
const legacyDocument: KnowledgeDocumentRef = { kind: "document", knowledgeId: "guide",
  locator: { type: "http", url: "https://example.test/guide" } };
const legacyProvider: UnvalidatedProviderRecord = { providerId: "seed.http", name: "Seed", version: "1", specification: {
  specificationId: "rules", version: "1",
  // @ts-expect-error Single entryRef was removed by the multi-document Specification contract.
  entryRef: "PROVIDER.md",
} };
const legacyRecord: UnvalidatedCapabilityRecord = { capabilityId: "route", name: "Route", description: "Routing", whenToUse: "When routing",
  // @ts-expect-error requiredBy is derived, never authored in a capability definition.
  requiredBy: ["other"],
};
void [document, legacyDocument, legacyProvider, legacyRecord];
void [missingProvider, unknownBudget, badBudget, badBatch, computeStaticRevision, resolveBudgets];
