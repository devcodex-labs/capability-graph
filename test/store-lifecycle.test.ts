import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test, { mock } from "node:test";
import { CapabilityGraph } from "../src/index.js";
import { CoreHost } from "../src/core-host.js";
import { FileAuthorityStore } from "../src/store/file-authority-store.js";
import { memoryGraphStore } from "../src/store/memory-graph-store.js";
import { ProviderViewStore } from "../src/store/provider-view-store.js";
import { validateSnapshot } from "../src/validate/index.js";
import { computeEffectiveScope } from "../src/scope.js";
import { CapabilityGraphError } from "../src/errors.js";
import { FileFixture, record } from "./contract/file-fixture.js";

async function view(name: string, fail = false) {
  const snapshot = await validateSnapshot({ source: { kind: "file", rootDir: "." },
    provider: { providerId: "seed", name: "Seed", version: "1" }, capabilities: [record("a", { name })] });
  let closes = 0;
  return { ...memoryGraphStore(snapshot), get closes() { return closes; }, async close() {
    closes++; if (fail) throw new Error("private cleanup secret");
  } };
}
const config = (fixture: FileFixture) => ({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: fixture.authority }] });

test("memory reverse indexes are exact and related edges are directional", async () => {
  const snapshot = await validateSnapshot({ source: { kind: "file", rootDir: "." },
    provider: { providerId: "seed", name: "Seed", version: "1" }, capabilities: [record("a", { related: ["z"] }), record("z")] });
  const source = memoryGraphStore(snapshot);
  assert.deepEqual((await source.getCapability("z"))?.related, []);
  assert.equal((await source.neighbors("z", "relatedBy", { limit: 100, maxBytes: 262144 })).items[0]?.capabilityId, "a");
});

test("pins retain current and previous views across repeated swaps and close", async () => {
  const store = new ProviderViewStore(); const sources = await Promise.all([1, 2, 3, 4].map((i) => view(String(i))));
  for (const source of sources.slice(0, 2)) await store.replaceProvider(source);
  const pin = store.pin();
  for (const source of sources.slice(2)) await store.replaceProvider(source);
  assert.deepEqual(sources.map((source) => source.closes), [0, 0, 0, 0]);
  assert.equal((await pin.previous!.getView("seed")!.getCapability("a"))!.name, "1");
  await store.close(); assert.deepEqual(sources.map((source) => source.closes), [0, 0, 1, 1]);
  assert.equal((await pin.current.getView("seed")!.getCapability("a"))!.name, "2");
  await pin.release(); await pin.release(); assert.deepEqual(sources.map((source) => source.closes), [1, 1, 1, 1]);
});

test("cleanup failure cannot undo a published swap and private diagnostics stay private", async () => {
  const store = new ProviderViewStore();
  await store.replaceProvider(await view("1", true));
  for (const name of ["2", "3"]) await store.replaceProvider(await view(name));
  const pin = store.pin(); assert.equal((await pin.current.getView("seed")!.getCapability("a"))!.name, "3"); await pin.release();
  await assert.rejects(store.close(), (error: unknown) => {
    assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_LOAD_FAILED");
    assert.deepEqual(error.details, { reason: "view_cleanup_failed", count: 1 });
    assert.doesNotMatch(JSON.stringify(error), /private cleanup secret/); return true;
  });
});

for (const queryFails of [false, true]) for (const cleanupFails of [false, true]) {
  test(`pinned query failure=${queryFails}, retirement cleanup failure=${cleanupFails} preserves its outcome`, async () => {
    const store = new ProviderViewStore(); const source = await view("1", cleanupFails);
    await store.replaceProvider(source); const pin = store.pin();
    await store.replaceProvider(await view("2")); await store.replaceProvider(await view("3"));
    assert.equal(source.closes, 0);
    const primary = new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
    const operation = async () => {
      try { if (queryFails) throw primary; return (await pin.current.getView("seed")!.getCapability("a"))!.name; }
      finally { await pin.release(); }
    };
    if (queryFails) await assert.rejects(operation(), (error: unknown) => error === primary);
    else assert.equal(await operation(), "1");
    assert.equal(source.closes, 1);
    if (cleanupFails) await assert.rejects(store.close(), { code: "CG_LOAD_FAILED" }); else await store.close();
  });
}

test("close reports direct and delayed final-pin cleanup failures exactly once", async () => {
  for (const pinned of [false, true]) {
    const store = new ProviderViewStore(); const source = await view("1", true); await store.replaceProvider(source);
    const pin = pinned ? store.pin() : undefined;
    if (pin) { await store.close(); assert.equal(source.closes, 0); await pin.release(); await pin.release(); }
    else await assert.rejects(store.close(), { code: "CG_LOAD_FAILED" });
    await assert.rejects(store.close(), { code: "CG_LOAD_FAILED" }); assert.equal(source.closes, 1);
  }
});

test("scope missing differs from explicit empty and request scope cannot expand", () => {
  assert.equal(computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: undefined, phase: "open" }).ok, false);
  const empty = computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: [], phase: "open" });
  assert.equal(empty.ok && empty.scope.size, 0);
  const denied = computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: ["seed"], request: ["other"], phase: "query" });
  assert.equal(!denied.ok && denied.error.code, "CG_SCOPE_DENIED");
});

test("file open is atomic across providers, rejects duplicates and permits explicit empty scope", async () => {
  const fixture = new FileFixture([record("a")]); const base = config(fixture);
  await assert.rejects(CapabilityGraph.open({ ...base, providers: [...base.providers, ...base.providers] }), { code: "CG_DUAL_AUTHORITY" });
  await assert.rejects(CapabilityGraph.open({ ...base, hostAllowedProviders: [] }), { code: "CG_SCOPE_DENIED" });
  await assert.rejects(CapabilityGraph.open({ ...base, providers: [] }), { code: "CG_CONFIG_INCOMPLETE" });
  const empty = await CapabilityGraph.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: [], providers: [] });
  assert.deepEqual((await empty.listCatalog()).meta.scope, []); await empty.close();
  await assert.rejects(CapabilityGraph.open({ ...base, hostAllowedProviders: ["seed", "other"], integrationEnabledProviders: ["seed", "other"],
    providers: [...base.providers, { providerId: "other", authority: { kind: "file", rootDir: path.join(fixture.rootDir, "missing") } }] }), { code: "CG_LOAD_FAILED" });
});

test("file reloads serialize and failed candidates preserve readable revisions", async () => {
  const fixture = new FileFixture([record("a")]); const host = await CoreHost.open(config(fixture));
  const original = FileAuthorityStore.prototype.load; let active = 0; let loads = 0;
  const hook = mock.method(FileAuthorityStore.prototype, "load", async function (this: FileAuthorityStore, ...args: Parameters<typeof original>) {
    assert.equal(++active, 1);
    try { loads++; await new Promise((resolve) => setTimeout(resolve, 2)); return await original.apply(this, args); }
    finally { active--; }
  });
  try {
    const initial = await host.query(undefined, undefined, async (ctx) => ctx.meta.staticRevision!);
    fixture.records = [record("a", { name: "2" })]; fixture.sync();
    await Promise.all([host.reload(), host.reload()]); assert.equal(loads, 2);
    const current = await host.query(undefined, undefined, async (ctx) => ctx.meta.staticRevision!); assert.notEqual(initial, current);
    await writeFile(path.join(fixture.rootDir, "provider.json"), "invalid-json");
    assert.equal((await host.reload()).ok, false);
    await host.query(undefined, current, async (ctx) => { assert.equal(ctx.meta.refreshFailed, true); assert.equal(ctx.meta.servedFrom, "current"); });
    await assert.rejects(host.query(undefined, initial, async () => {}), { code: "CG_REVISION_MISMATCH" });
  } finally { hook.mock.restore(); await host.close(); }
  await assert.rejects(host.query(undefined, undefined, async () => {}), { code: "CG_NO_ACTIVE_VIEW" });
});

test("queries pin real file views through reload and close", async () => {
  const fixture = new FileFixture([record("a", { name: "old" })]); const host = await CoreHost.open(config(fixture));
  let entered!: () => void; let resume!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; }); const gate = new Promise<void>((resolve) => { resume = resolve; });
  const pending = host.query(undefined, undefined, async (ctx) => { entered(); await gate; return (await ctx.graph.getView("seed")!.getCapability("a"))!.name; });
  try {
    await started;
    for (const name of ["new", "latest"]) { fixture.records = [record("a", { name })]; fixture.sync(); await host.reload(); }
    await host.close(); resume(); assert.equal(await pending, "old");
  } finally { resume(); await pending; await host.close(); }
});
