import { CapabilityGraphError, formatQualifiedId, parseQualifiedId,
  type CanonicalCapabilityId, type BudgetConfig, type BudgetOverrides,
  type ErrorShape, type BatchItem, type BatchResult, type ProviderResult, type NeighborPage, type KnowledgeReader } from "@devcodex/capability-graph";

const rangeReader: NonNullable<KnowledgeReader["readRange"]> = async (_ref, _context, options) => ({
  bytes: new Uint8Array(options.endOffset - options.startOffset), contentId: options.contentId,
  contentType: "text/plain", source: "https://example.test/document", totalBytes: options.endOffset,
});
// @ts-expect-error Range results must identify the complete source length.
const incompleteRangeReader: NonNullable<KnowledgeReader["readRange"]> = async () => ({ bytes: new Uint8Array(), contentId: "k:1", source: "x", contentType: "text/plain" });
void [rangeReader, incompleteRangeReader];

const id: CanonicalCapabilityId = { providerId: "seed.http", capabilityId: "route.http" };
const encoded: string = formatQualifiedId(id);
const decoded: CanonicalCapabilityId = parseQualifiedId(encoded);
const override: BudgetOverrides = { catalog: { maxBytes: 8_192 }, neighbors: { maxBytes: 8_192, maxItemBytes: 1_024 } };
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
const newReadLimits: BudgetOverrides = { read: { maxPageBytes: 32768, maxSelected: 32, maxFilterValuesPerDimension: 128, maxResponseBytes: 4194304 } };
function oldFullBudgetConsumer(config: Omit<BudgetConfig, "read"> & { read: { maxBytes: number; maxDocumentsPerCall: number } }): BudgetConfig {
  return config;
}
// @ts-expect-error New read limits require numeric configuration.
const badReadLimit: BudgetOverrides = { read: { maxResponseBytes: "4194304" } };
void [newReadLimits, oldFullBudgetConsumer, badReadLimit];
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
// Source definition records remain an internal implementation detail.
// @ts-expect-error Raw records are no longer public database adapter inputs.
import type { UnvalidatedCapabilityRecord } from "@devcodex/capability-graph";
// @ts-expect-error Validated internal graph nodes are not the public bounded detail projection.
import type { StaticCapability } from "@devcodex/capability-graph";
import type { BoundProviderGraph, CapabilityDetail, KnowledgeDocumentRef, SelectionResult,
  ProviderLoadSpec } from "@devcodex/capability-graph";
function graphConsumer(bound: BoundProviderGraph, detail: CapabilityDetail, neighbors: NeighborPage) {
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
  void bound.readDocumentPage({ capabilityId: "route.validation", knowledgeId: "D-02", maxBytes: 4096 });
  void bound.readSpecificationPage({ knowledgeId: "SPEC-01" });
  // @ts-expect-error Bound calls cannot override provider scope.
  void bound.listCatalog({ requestProviderScope: ["other"] });
  // @ts-expect-error Detail does not expose internal full adjacency lists.
  void detail.parents;
}
void graphConsumer;
const document: KnowledgeDocumentRef = { kind: "document", knowledgeId: "guide", role: "guide",
  locator: { type: "http", url: "https://example.test/guide" } };
// @ts-expect-error v1.0.1 requires a role on every Document.
const legacyDocument: KnowledgeDocumentRef = { kind: "document", knowledgeId: "guide",
  locator: { type: "http", url: "https://example.test/guide" } };
void [document, legacyDocument];
void [missingProvider, unknownBudget, badBudget, badBatch, computeStaticRevision, resolveBudgets];

function removedApis(graph: import("@devcodex/capability-graph").CapabilityGraph, bound: BoundProviderGraph) {
  // @ts-expect-error Capability recall moved outside the graph.
  graph.retrieveCapabilities({ text: "route" });
  // @ts-expect-error Knowledge search moved outside the graph.
  bound.queryKnowledge({ text: "route", selected: [] });
  // @ts-expect-error Running instance observation moved outside the graph.
  graph.queryRuntime({ project: "app", environment: "local" });
}
// @ts-expect-error Database authorities are unsupported in 2.0.
const databaseSource: ProviderLoadSpec = { providerId: "seed", authority: { kind: "database" } };
// @ts-expect-error Runtime budgets are removed.
const runtimeBudget: BudgetOverrides = { runtime: { timeoutMs: 100 } };
void [removedApis, databaseSource, runtimeBudget];

// @ts-expect-error The unused Runtime timeout code is removed.
const removedTimeout: import("@devcodex/capability-graph").ErrorCode = "CG_TIMEOUT";
// @ts-expect-error Collections now use member listing, not a retrieval recovery action.
const removedRecovery: import("@devcodex/capability-graph").NextAction = "use_retrieval";
void [removedTimeout, removedRecovery];
