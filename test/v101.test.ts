import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type KnowledgeDocumentRef, type KnowledgeReader } from "../src/index.js";
import { normalizeLocale } from "../src/locale.js";
import { contentId } from "../src/knowledge/local-file-reader.js";
import { validateSnapshot } from "../src/validate/index.js";
import { FileFixture, record } from "./contract/file-fixture.js";

const id = (capabilityId: string, providerId = "seed") => ({ providerId, capabilityId });
const code = (value: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === value;
const doc = (knowledgeId: string, role = "guide", locale = "en"): KnowledgeDocumentRef => ({
  kind: "document", knowledgeId, role, locale, locator: { type: "http", url: `https://example.test/${knowledgeId}` },
});
const config = (fixture: FileFixture, extras: Record<string, unknown> = {}) => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: fixture.authority }], ...extras,
});

test("v1.0.1 locale uses registered subtags, legacy replacements and exact canonical values", () => {
  assert.equal(normalizeLocale("ZH-cn"), "zh-CN");
  assert.equal(normalizeLocale("x-ACME"), "x-acme");
  assert.equal(normalizeLocale("i-klingon"), "tlh");
  assert.equal(normalizeLocale("en-GB-oed"), "en-GB-oxendict");
  assert.equal(normalizeLocale("zh-yue-HK"), "yue-HK");
  for (const invalid of ["en-AB", "sl-rozaj-rozaj", "en-a-foo-a-bar", "en--US", "x", "a".repeat(129)]) {
    assert.throws(() => normalizeLocale(invalid), code("CG_INPUT_INVALID"));
  }
});

test("v1.0.1 file loading preserves normalized graph identity and reject Provider-wide knowledge conflicts", async () => {
  const rows = [record("a", { requires: ["z"], knowledge: [doc("intro")] }), record("z")];
  const source = { source: { kind: "file" as const, rootDir: "unused" },
    provider: { providerId: "seed", name: "Seed", version: "1" }, capabilities: rows };
  const file = await validateSnapshot(source);
  const fixture = new FileFixture(rows);
  const graph = await CapabilityGraph.open(config(fixture));
  try {
    assert.equal((await graph.getProvider("seed")).staticRevision, file.staticRevision);
    assert.deepEqual((await graph.getNeighbors(id("z"), { kinds: ["requiredBy"] })).groups.requiredBy.items.map((row) => row.id.capabilityId), ["a"]);
  } finally { await graph.close(); }
  const conflict = new FileFixture([record("a", { knowledge: [doc("shared", "guide")] }),
    record("b", { knowledge: [doc("shared", "reference")] })]);
  await assert.rejects(CapabilityGraph.open(config(conflict)), code("CG_VALIDATION_FAILED"));
  const duplicate = new FileFixture([record("a", { requires: ["b", "b"] }), record("b")]);
  await assert.rejects(CapabilityGraph.open(config(duplicate)), code("CG_VALIDATION_FAILED"));
  const cycle = new FileFixture([record("a", { requires: ["b"] }), record("b", { requires: ["a"] })]);
  await assert.rejects(CapabilityGraph.open(config(cycle)), code("CG_RELATION_CYCLE"));
});

test("v1.0.1 Selection returns every direct reason and the exact requires closure", async () => {
  const fixture = new FileFixture([record("a", { requires: ["b"], related: ["d"] }), record("b", { requires: ["c"] }), record("c"), record("d", { requires: ["b"] })]);
  const graph = await CapabilityGraph.open(config(fixture));
  try {
    const result = await graph.resolveSelection({ selected: [id("d"), id("a")] });
    assert.deepEqual(result.requested.map((item) => item.capabilityId), ["d", "a"]);
    assert.deepEqual(result.resolved.map((item) => item.capabilityId), ["a", "b", "c", "d"]);
    assert.deepEqual(result.added.map((item) => item.capabilityId), ["b", "c"]);
    assert.deepEqual(result.reasons.find((item) => item.id.capabilityId === "b")?.reason.requiredBy.map((item) => item.capabilityId), ["a", "d"]);
    assert.equal(result.requiresEdges.length, 3);
    assert.equal(result.meta.staticRevisionByProvider?.seed, result.meta.staticRevision);
    assert.throws(() => graph.resolveSelection({ selected: Array(33).fill(id("a")) }), code("CG_BUDGET_EXCEEDED"));
  } finally { await graph.close(); }
});

test("v1.0.1 Selection pins per-Provider current and previous independently", async () => {
  let one = new FileFixture([record("a")]);
  const two = new FileFixture([record("b")]); two.provider = { providerId: "other", name: "Other", version: "1" };
  const graph = await CapabilityGraph.open({ hostAllowedProviders: ["seed", "other"], integrationEnabledProviders: ["seed", "other"],
    providers: [{ providerId: "seed", authority: one.authority },
      { providerId: "other", authority: two.authority }] });
  try {
    const old = (await graph.getProvider("seed")).staticRevision;
    const other = (await graph.getProvider("other")).staticRevision;
    one.records = [record("a", { name: "Changed" })]; one.sync();
    assert.equal((await graph.reload({ providerId: "seed" })).ok, true);
    const result = await graph.resolveSelection({ selected: [id("a"), id("b", "other")],
      requiredStaticRevisionByProvider: { seed: old, other } });
    assert.equal(result.meta.servedFrom, "mixed");
    assert.deepEqual(result.meta.servedFromByProvider, { other: "current", seed: "previous" });
    await assert.rejects(graph.resolveSelection({ selected: [id("a"), id("b", "other")],
      requiredStaticRevisionByProvider: { seed: old } }), code("CG_INPUT_INVALID"));
  } finally { await graph.close(); }
});

test("v1.0.1 discovery and direct reads expose routing without expanding Collections", async () => {
  const fixture = new FileFixture([record("a", { knowledge: [doc("top", "guide", "en"),
    { kind: "collection", knowledgeId: "set", title: "Set", members: [doc("member", "reference", "zh-CN")] }] })]);
  fixture.provider = { ...fixture.provider, specification: { specificationId: "rules", version: "1",
    documents: [doc("spec-en", "specification", "en"), doc("spec-zh", "specification", "zh-CN")] } } as typeof fixture.provider;
  const bytes = new TextEncoder().encode("body");
  const reader: KnowledgeReader = { id: "http", canRead: () => true,
    read: async (ref) => ({ bytes, contentId: contentId(bytes), contentType: "text/plain", source: ref.locator.type === "http" ? ref.locator.url : "" }) };
  const graph = await CapabilityGraph.open(config(fixture, { readers: [reader], budgets: { specification: { defaultPageSize: 1 } } }));
  try {
    const summary = (await graph.listProviders()).items[0]!;
    assert.equal(summary.specification?.documentCount, 2);
    assert.equal(JSON.stringify(summary).includes("spec-en"), false);
    const provider = await graph.getProvider("seed");
    assert.equal(provider.specificationDocuments?.items.length, 1);
    const more = await graph.listSpecificationDocuments({ providerId: "seed", cursor: provider.specificationDocuments!.nextCursor });
    assert.equal(more.items.length, 1);
    const detail = await graph.getCapabilities([id("a")]);
    assert.ok(detail.results[0]?.ok);
    assert.equal(detail.results[0].value.knowledge.items.find((item) => item.kind === "collection")?.knowledgeId, "set");
    const members = await graph.listKnowledgeMembers({ capability: id("a"), collectionId: "set" });
    assert.equal(members.items[0]?.role, "reference");
    const filtered = await graph.readDocuments({ selected: [id("a")], roles: ["reference"], locales: ["zh-CN"] });
    assert.equal(filtered.knowledgeState, "filtered_empty");
    const direct = await graph.readDocuments({ selected: [id("a")], knowledgeIds: ["member"], roles: ["reference"], locales: ["zh-CN"] });
    assert.equal(direct.results[0]?.ok, true);
    const spec = await graph.readSpecification({ providerId: "seed", locales: ["zh-CN"] });
    assert.equal(spec.results[0]?.ok, true);
    assert.equal(spec.results[0].value.providerId, "seed");
  } finally { await graph.close(); }
});

test("v1.0.1 metadata pages shrink to the byte budget and resume without loss", async () => {
  const documents = Array.from({ length: 4 }, (_, index) => ({ ...doc(`spec-${index}`, "specification"), title: "T".repeat(200), summary: "S".repeat(400) }));
  const members = Array.from({ length: 4 }, (_, index) => ({ ...doc(`member-${index}`), title: "T".repeat(200), summary: "S".repeat(400) }));
  const fixture = new FileFixture([record("a", { knowledge: [{ kind: "collection", knowledgeId: "set", members }] })]);
  fixture.provider = { ...fixture.provider, specification: { specificationId: "rules", version: "1", documents } } as typeof fixture.provider;
  const graph = await CapabilityGraph.open(config(fixture, { budgets: { specification: { maxBytes: 1900 }, detail: { maxBytes: 1900 } } }));
  try {
    const first = (await graph.getProvider("seed")).specificationDocuments!;
    assert.ok(first.items.length > 0 && first.items.length < documents.length);
    const specIds = [...first.items.map((item) => item.knowledgeId)];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await graph.listSpecificationDocuments({ providerId: "seed", cursor });
      specIds.push(...page.items.map((item) => item.knowledgeId)); cursor = page.nextCursor;
    }
    assert.deepEqual(specIds, documents.map((item) => item.knowledgeId));
    const memberIds: string[] = []; let memberCursor: string | undefined;
    do {
      const page = await graph.listKnowledgeMembers({ capability: id("a"), collectionId: "set", cursor: memberCursor });
      memberIds.push(...page.items.map((item) => item.knowledgeId)); memberCursor = page.nextCursor;
    } while (memberCursor);
    assert.deepEqual(memberIds, members.map((item) => item.knowledgeId));
  } finally { await graph.close(); }
});

test("v1.0.1 read filters intersect, Specification states stay distinct, and Reader failures are partial", async () => {
  const fixture = new FileFixture([record("a", { knowledge: [doc("guide-en", "guide", "en"),
    doc("reference-zh", "reference", "zh-CN"), { ...doc("unlocalized", "reference"), locale: undefined }] })]);
  const bytes = new TextEncoder().encode("body");
  const reader: KnowledgeReader = { id: "http", canRead: () => true,
    read: async (ref) => ({ bytes, contentId: contentId(bytes), contentType: "text/plain",
      source: ref.locator.type === "http" && ref.knowledgeId !== "spec-bad" ? ref.locator.url : "https://wrong.test/" }) };
  const graph = await CapabilityGraph.open(config(fixture, { readers: [reader] }));
  try {
    assert.equal((await graph.readSpecification({ providerId: "seed" })).knowledgeState, "not_associated");
    const only = await graph.readDocuments({ selected: [id("a")], roles: ["guide", "reference"], locales: ["zh-CN"] });
    assert.deepEqual(only.results.filter((item) => item.ok).map((item) => item.value.knowledgeId), ["reference-zh"]);
    assert.equal((await graph.readDocuments({ selected: [id("a")], roles: ["guide"], locales: ["zh-CN"] })).knowledgeState, "filtered_empty");
  } finally { await graph.close(); }

  const withSpec = new FileFixture([record("a")]);
  withSpec.provider = { ...withSpec.provider, specification: { specificationId: "rules", version: "1",
    documents: [doc("spec-good", "specification", "en"), doc("spec-bad", "specification", "en")] } } as typeof withSpec.provider;
  const graph2 = await CapabilityGraph.open(config(withSpec, { readers: [reader] }));
  try {
    assert.equal((await graph2.readSpecification({ providerId: "seed", locales: ["zh-CN"] })).knowledgeState, "filtered_empty");
    const result = await graph2.readSpecification({ providerId: "seed", locales: ["en"], knowledgeIds: ["spec-good", "spec-bad"] });
    assert.equal(result.knowledgeState, "matched");
    assert.deepEqual(result.results.map((item) => item.ok), [false, true]);
    assert.equal(result.meta.completeness, "partial");
    const unknown = await graph2.readSpecification({ providerId: "seed", knowledgeIds: ["missing"] });
    assert.equal(unknown.results[0]?.ok, false);
  } finally { await graph2.close(); }
  const empty = new FileFixture([record("a")]);
  empty.provider = { ...empty.provider, specification: { specificationId: "rules", version: "1", documents: [] } } as typeof empty.provider;
  await assert.rejects(CapabilityGraph.open(config(empty)), code("CG_VALIDATION_FAILED"));
});

test("v1.0.1 route metadata changes static identity while body changes only content identity", async () => {
  const base = { source: { kind: "file" as const, rootDir: "unused" },
    provider: { providerId: "seed", name: "Seed", version: "1" }, capabilities: [record("a", { knowledge: [doc("guide")] })] };
  const metadataChanged = { ...base, capabilities: [record("a", { knowledge: [{ ...doc("guide"), title: "New title" }] })] };
  assert.notEqual((await validateSnapshot(base)).staticRevision, (await validateSnapshot(metadataChanged)).staticRevision);

  const fixture = new FileFixture(base.capabilities);
  let body = new TextEncoder().encode("first body");
  const reader: KnowledgeReader = { id: "http", canRead: () => true,
    read: async (ref) => ({ bytes: body, contentId: contentId(body), contentType: "text/plain",
      source: ref.locator.type === "http" ? ref.locator.url : "" }) };
  const graph = await CapabilityGraph.open(config(fixture, { readers: [reader] }));
  try {
    const revision = (await graph.getProvider("seed")).staticRevision;
    const first = await graph.readDocuments({ selected: [id("a")] });
    body = new TextEncoder().encode("second body");
    const second = await graph.readDocuments({ selected: [id("a")] });
    assert.equal(first.results[0]?.ok, true); assert.equal(second.results[0]?.ok, true);
    assert.notEqual(first.results[0].value.contentId, second.results[0].value.contentId);
    assert.equal((await graph.getProvider("seed")).staticRevision, revision);
  } finally { await graph.close(); }
});
