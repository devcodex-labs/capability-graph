import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type OpenConfig, type RuntimeAdapter, type RuntimeAdapterResult } from "../src/index.js";
import { FakeDatabase, record } from "./contract/fake-database.js";
import { FixtureRuntimeAdapter, instance } from "./contract/fixture-runtime-adapter.js";

const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const query = { project: "project-a", environment: "test" };
const config = (adapter?: RuntimeAdapter, extra: Partial<OpenConfig> = {}): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], runtimeAdapters: adapter ? [adapter] : [],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: async () => new FakeDatabase([record("a"), record("b")]) } } }], ...extra,
});
const reply = (instances: RuntimeAdapterResult["instances"], overrides: Partial<RuntimeAdapterResult["observation"]> = {}, nextCursor?: string): RuntimeAdapterResult => ({
  instances, observation: { source: "fixture://routes", observedAt: new Date().toISOString(), runtimeRevision: "r:1", observedAgainstStaticRevision: "s:old",
    availability: instances.length ? "available" : "empty", freshness: "current", compatibility: "unknown", ...overrides },
  ...(nextCursor === undefined ? {} : { nextCursor }),
});

test("extension configuration rejects explicit null arrays and malformed provider identities", async () => {
  for (const extra of [{ readers: null }, { runtimeAdapters: null }, { runtimeAdapters: [{ id: "bad", providerId: "Bad Provider", query: async () => reply([]) }] }]) {
    await assert.rejects(CapabilityGraph.open(config(undefined, extra as unknown as Partial<OpenConfig>)), code("CG_CONFIG_INCOMPLETE"));
  }
});

test("non-F-18: missing project/environment precedes disabled runtime; duplicate adapters fail open", async () => {
  const graph = await CapabilityGraph.open(config());
  try {
    assert.throws(() => graph.queryRuntime({ project: "project-a" } as never), code("CG_RUNTIME_CONTEXT_REQUIRED"));
    await assert.rejects(graph.queryRuntime(query), code("CG_RUNTIME_DISABLED"));
  } finally { await graph.close(); }
  const adapter = new FixtureRuntimeAdapter();
  await assert.rejects(CapabilityGraph.open(config(adapter, { runtimeAdapters: [adapter, adapter] })), code("CG_CONFIG_INCOMPLETE"));
});

test("non-F-18: real source empty and partial empty remain distinct from unavailable", async () => {
  for (const availability of ["empty", "partial"] as const) {
    const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => reply([], { availability, coverage: "subset" }))));
    try {
      const page = await graph.queryRuntime(query); assert.equal(page.observation.availability, availability);
      assert.equal(page.meta.completeness, availability === "partial" ? "partial" : "complete");
    } finally { await graph.close(); }
  }
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => { throw new Error("private-source"); })));
  try { await assert.rejects(graph.queryRuntime(query), code("CG_RUNTIME_UNAVAILABLE")); assert.equal((await graph.listCatalog()).items.length, 2); }
  finally { await graph.close(); }
});

test("non-F-18: partial and stale are orthogonal; observed revision is never rewritten to current", async () => {
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => reply([instance()], {
    availability: "partial", freshness: "stale", coverage: "one source", freshnessLimit: "old build", compatibility: "refresh_required",
  }))));
  try {
    const page = await graph.queryRuntime(query);
    assert.equal(page.observation.availability, "partial"); assert.equal(page.observation.freshness, "stale");
    assert.equal(page.meta.completeness, "partial"); assert.equal(page.observation.observedAgainstStaticRevision, "s:old");
    assert.equal(page.meta.view?.runtime?.compatibility, "refresh_required");
    assert.notEqual(page.meta.view?.runtime?.queriedStaticRevision, "s:old");
  } finally { await graph.close(); }
});

test("non-F-18: every rejected item becomes query failure without an empty page, observation or cursor", async () => {
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => reply([instance("private-id", { providerId: "outside", facts: { secretSource: "private" } })], {}, "tail"))));
  try {
    await assert.rejects(graph.queryRuntime(query), (error: unknown) => {
      assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_ADAPTER_CONTRACT_INVALID");
      assert.deepEqual(error.details, { reason: "all_runtime_items_rejected", receivedCount: 1, rejectedCount: 1 });
      assert.equal(JSON.stringify(error).includes("private"), false); return true;
    });
  } finally { await graph.close(); }
});

test("non-F-18: mixed invalid context/type/target entries are removed with bounded warnings", async () => {
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => reply([
    instance("good"), instance("wrong-environment", { environment: "production" }), instance("wrong-project", { project: "other" }),
    instance("missing-type", { instanceOf: { providerId: "seed", capabilityId: "missing" } }),
    instance("cross-type", { instanceOf: { providerId: "other", capabilityId: "a" } }),
  ]))));
  try {
    const page = await graph.queryRuntime(query); assert.deepEqual(page.items.map((entry) => entry.instanceId), ["good"]);
    assert.equal(page.meta.completeness, "partial"); assert.equal(page.meta.warnings.length, 4);
    assert.equal(JSON.stringify(page.meta.warnings).includes("production"), false);
    assert.equal((await graph.forProvider("seed").queryRuntime({ ...query, instanceOf: { capabilityId: "a" }, instanceId: "good" })).items.length, 1);
  } finally { await graph.close(); }
});

test("non-F-18: excessive pages, duplicate identities and inconsistent observations are query failures", async () => {
  const cases = [reply([instance("a"), instance("b")]), reply([instance(), instance()]), reply([], { availability: "available" }),
    reply([instance()], { availability: "empty" }), reply([], { availability: "empty" }, "tail"), reply([instance()], {}, "")];
  for (const [index, value] of cases.entries()) {
    const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => value)));
    try { await assert.rejects(graph.queryRuntime({ ...query, limit: index === 0 ? 1 : 10 }), code("CG_ADAPTER_CONTRACT_INVALID")); }
    finally { await graph.close(); }
  }
});

test("non-F-18: facts and association budgets reject whole items, not partial JSON", async () => {
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => reply([
    instance("good", { facts: { ok: true } }), instance("large", { facts: { text: "x".repeat(100) } }),
    instance("association", { facts: {}, associations: [{ kind: "link", facts: { text: "x".repeat(100) } }] }),
  ])), { budgets: { runtime: { maxFactsBytes: 50, maxAssociationBytes: 50 } } }));
  try {
    const page = await graph.queryRuntime(query); assert.equal(page.items.length, 1);
    assert.deepEqual(page.meta.warnings.map((entry) => entry.code), ["CG_BUDGET_EXCEEDED", "CG_BUDGET_EXCEEDED"]);
  } finally { await graph.close(); }
});

test("non-F-18: Runtime cursor binds source revision, static revision and complete target filters", async () => {
  let version = "r:1"; let supplied: string | undefined;
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter((input) => {
    supplied = input.cursor; return reply([instance(input.cursor ? "second" : "first")], { runtimeRevision: version }, input.cursor ? undefined : "adapter:page-two");
  })));
  try {
    const first = await graph.queryRuntime({ ...query, limit: 1 }); assert.ok(first.nextCursor); assert.equal(first.meta.completeness, "truncated");
    const second = await graph.queryRuntime({ ...query, limit: 1, cursor: first.nextCursor });
    assert.equal(supplied, "adapter:page-two"); assert.equal(second.items[0]?.instanceId, "second");
    await assert.rejects(graph.queryRuntime({ ...query, limit: 1, environment: "other", cursor: first.nextCursor }), code("CG_REVISION_MISMATCH"));
    version = "r:2";
    await assert.rejects(graph.queryRuntime({ ...query, limit: 1, cursor: first.nextCursor }), code("CG_REVISION_MISMATCH"));
    await assert.rejects(graph.queryRuntime({ ...query, requiredRuntimeRevision: "r:1" }), code("CG_REVISION_MISMATCH"));
  } finally { await graph.close(); }
});

test("non-F-18: never-returning adapter times out without retaining its timer or blocking static work", async () => {
  const graph = await CapabilityGraph.open(config(new FixtureRuntimeAdapter(() => new Promise(() => {})), { budgets: { runtime: { timeoutMs: 10 } } }));
  try { await assert.rejects(graph.queryRuntime(query), code("CG_RUNTIME_UNAVAILABLE")); assert.equal((await graph.listCatalog()).items.length, 2); }
  finally { await graph.close(); }
});

test("non-F-18: Runtime cannot union multiple providers or affect static Catalog", async () => {
  const base = config(new FixtureRuntimeAdapter());
  const graph = await CapabilityGraph.open({ ...base, hostAllowedProviders: ["seed", "other"], integrationEnabledProviders: ["seed", "other"],
    providers: [...base.providers, { providerId: "other", authority: { kind: "database", adapter: { id: "other", openView: async () => {
      const db = new FakeDatabase([record("a")]); db.provider.providerId = "other"; return db;
    } } } }] });
  try {
    await assert.rejects(graph.queryRuntime(query), code("CG_INPUT_INVALID"));
    const before = await graph.listCatalog();
    await graph.queryRuntime({ ...query, instanceOf: { providerId: "seed", capabilityId: "a" } });
    assert.deepEqual(await graph.listCatalog(), before);
  } finally { await graph.close(); }
});
