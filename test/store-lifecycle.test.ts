import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CoreHost, type StaticOpenConfig } from "../src/core-host.js";
import { CapabilityGraphError } from "../src/errors.js";
import { computeEffectiveScope } from "../src/scope.js";
import { databaseAuthorityStore } from "../src/store/database-authority-store.js";
import { memoryGraphStore } from "../src/store/memory-graph-store.js";
import { ProviderViewStore } from "../src/store/provider-view-store.js";
import { validateSnapshot } from "../src/validate/index.js";
import { FakeDatabase, record } from "./contract/fake-database.js";

const code = (expected: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === expected;
const page = { limit: 100, maxBytes: 262144 };
const file = (db: FakeDatabase) => validateSnapshot({ source: { kind: "file", rootDir: "." }, provider: db.provider, capabilities: db.records });
const config = (open: () => Promise<FakeDatabase>): StaticOpenConfig => ({ hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"],
  providers: [{ providerId: "seed", authority: { kind: "database", adapter: { id: "fake", openView: open } } }] });

test("DB A completes all pages before endpoint checks; hash equals file independent of pagination", async () => {
  for (const size of [1, 2, 100]) {
    const db = new FakeDatabase([record("a", { parents: ["z"] }), record("z")]); db.pageSize = size;
    db.onRead = () => assert.equal(db.scans, Math.ceil(2 / size));
    const view = await databaseAuthorityStore(db, "seed");
    assert.equal(view.staticRevision, (await file(db)).staticRevision);
    db.onRead = undefined;
    const before = db.scans;
    const first = await view.listCapabilities({ ...page, limit: 1 });
    assert.equal(first.items.length, 1); assert.equal(db.scans, before + 1);
    assert.equal((await view.getCapability("a"))?.parents[0]?.capabilityId, "z");
    assert.deepEqual((await view.neighbors("z", "children", page)).items, [{ providerId: "seed", capabilityId: "a" }]);
    await view.close(); await view.close(); assert.equal(db.closed, 1);
  }
});

test("DB independently rejects disconnected parents and specializes cycles after complete scan", async () => {
  for (const relation of ["parents", "specializes"] as const) {
    const db = new FakeDatabase([record("a"), record("y", { [relation]: ["z"] }), record("z", { [relation]: ["y"] })]);
    await assert.rejects(databaseAuthorityStore(db, "seed"), code("CG_RELATION_CYCLE"));
    assert.equal(db.scans, 3); assert.equal(db.closed, 1);
  }
  const db = new FakeDatabase([record("a", { parents: ["z"], related: ["z"] }), record("z", { specializes: ["a"], related: ["a"] })]);
  await (await databaseAuthorityStore(db, "seed")).close();
});

test("DB rejects dangling, unordered, duplicate and changed records and closes each candidate", async () => {
  for (const [records, expected] of [
    [[record("a", { related: ["z"] })], "CG_VALIDATION_FAILED"],
    [[record("z"), record("a")], "CG_ADAPTER_CONTRACT_INVALID"],
    [[record("a"), record("a")], "CG_ADAPTER_CONTRACT_INVALID"],
  ] as const) {
    const db = new FakeDatabase([...records]);
    await assert.rejects(databaseAuthorityStore(db, "seed"), code(expected)); assert.equal(db.closed, 1);
  }
  const db = new FakeDatabase([record("a")]);
  db.onRead = () => { db.records = [record("a", { description: "changed" })]; };
  await assert.rejects(databaseAuthorityStore(db, "seed"), code("CG_ADAPTER_CONTRACT_INVALID")); assert.equal(db.closed, 1);
});

test("DB detects revision drift during A and unreadable empty D; no candidate is published", async () => {
  const drift = new FakeDatabase([record("a")]); drift.onScan = () => { drift.sourceRevision = "db:2"; };
  await assert.rejects(databaseAuthorityStore(drift, "seed"), code("CG_REVISION_MISMATCH"));
  const empty = new FakeDatabase([]); empty.onScan = () => { if (empty.scans === 2) throw new Error("lost handle"); };
  await assert.rejects(databaseAuthorityStore(empty, "seed")); assert.equal(empty.closed, 1);
  const good = new FakeDatabase([]); const view = await databaseAuthorityStore(good, "seed");
  assert.equal(good.scans, 2); assert.equal(view.staticRevision, (await file(good)).staticRevision); await view.close();
});

test("DB rejects oversized, looping and falsely reported neighbor pages", async () => {
  const db = new FakeDatabase([record("a"), record("b")]);
  const view = await databaseAuthorityStore(db, "seed");
  db.neighbors = async () => ({ items: [{ providerId: "seed", capabilityId: "b" }] });
  await assert.rejects(view.neighbors("a", "parents", page), code("CG_ADAPTER_CONTRACT_INVALID"));
  db.scanCapabilities = async () => ({ items: [record("a"), record("b")] });
  await assert.rejects(view.listCapabilities({ ...page, limit: 1 }), code("CG_ADAPTER_CONTRACT_INVALID"));
  await view.close();
  const looping = new FakeDatabase([record("a")]); looping.scanCapabilities = async () => ({ items: [record("a")], nextCursor: "same" });
  await assert.rejects(databaseAuthorityStore(looping, "seed"), code("CG_ADAPTER_CONTRACT_INVALID"));
  const big = new FakeDatabase([record("a", { description: "x".repeat(262144) })]);
  await assert.rejects(databaseAuthorityStore(big, "seed"), code("CG_BUDGET_EXCEEDED"));
});

test("DB query pagination rejects cross-page duplicate catalog and neighbor rows", async () => {
  const db = new FakeDatabase([
    record("a", { parents: ["root"] }), record("b", { parents: ["root"] }),
    record("c", { parents: ["root"] }), record("root"),
  ]);
  const view = await databaseAuthorityStore(db, "seed");
  try {
    db.scanCapabilities = async (request) => request.cursor === undefined
      ? { items: [db.records[0]!, db.records[1]!], nextCursor: "catalog-2" }
      : { items: [db.records[1]!, db.records[2]!] };
    const catalog = await view.listCapabilities({ ...page, limit: 2 });
    assert.ok(catalog.nextCursor);
    await assert.rejects(view.listCapabilities({ ...page, limit: 2, cursor: catalog.nextCursor }), code("CG_ADAPTER_CONTRACT_INVALID"));

    const endpoint = (capabilityId: string) => ({ providerId: "seed", capabilityId });
    db.neighbors = async (_id, _kind, request) => request.cursor === undefined
      ? { items: [endpoint("a"), endpoint("b")], nextCursor: "neighbors-2" }
      : { items: [endpoint("b"), endpoint("c")] };
    const neighbors = await view.neighbors("root", "children", { ...page, limit: 2 });
    assert.ok(neighbors.nextCursor);
    await assert.rejects(view.neighbors("root", "children", { ...page, limit: 2, cursor: neighbors.nextCursor }), code("CG_ADAPTER_CONTRACT_INVALID"));
  } finally { await view.close(); }
});

test("memory reverse indexes are exact and do not add implicit related forward edges", async () => {
  const db = new FakeDatabase([record("a", { related: ["z"] }), record("z")]);
  const view = memoryGraphStore(await file(db));
  assert.deepEqual((await view.getCapability("z"))?.related, []);
  assert.equal((await view.neighbors("z", "relatedBy", page)).items[0]?.capabilityId, "a");
});

test("pins retain current/previous sources across repeated swaps and close", async () => {
  const store = new ProviderViewStore();
  const dbs = [1, 2, 3, 4].map((i) => new FakeDatabase([record("a", { name: String(i) })]));
  for (const db of dbs.slice(0, 2)) await store.replaceProvider(await databaseAuthorityStore(db, "seed"));
  const pin = store.pin();
  for (const db of dbs.slice(2)) await store.replaceProvider(await databaseAuthorityStore(db, "seed"));
  assert.equal(dbs[0]!.closed, 0); assert.equal(dbs[1]!.closed, 0);
  assert.equal((await pin.previous!.getView("seed")!.getCapability("a"))!.name, "1");
  await store.close(); assert.equal(dbs[2]!.closed, 1); assert.equal(dbs[3]!.closed, 1);
  assert.equal((await pin.current.getView("seed")!.getCapability("a"))!.name, "2");
  await pin.release(); await pin.release(); assert.deepEqual(dbs.map((db) => db.closed), [1, 1, 1, 1]);
});

test("cleanup failure cannot turn an already published swap into a failed reload", async () => {
  const store = new ProviderViewStore();
  const db = new FakeDatabase([record("a")]); db.close = async () => { throw new Error("private path"); };
  await store.replaceProvider(await databaseAuthorityStore(db, "seed"));
  for (const n of [2, 3]) await store.replaceProvider(await databaseAuthorityStore(new FakeDatabase([record("a", { name: String(n) })]), "seed"));
  const pin = store.pin(); assert.equal((await pin.current.getView("seed")!.getCapability("a"))!.name, "3"); await pin.release();
  await assert.rejects(store.close(), code("CG_LOAD_FAILED"));
});

for (const queryFails of [false, true]) for (const cleanupFails of [false, true]) {
  test(`R2: query failure=${queryFails} and retired cleanup failure=${cleanupFails} preserve the primary outcome`, async () => {
    const db = new FakeDatabase([record("a")]); let version = 0;
    db.close = async () => { db.closed++; if (cleanupFails) throw new Error("private cleanup secret"); };
    const host = await CoreHost.open(config(async () => ++version === 1 ? db : new FakeDatabase([record("a", { name: String(version) })])));
    let started!: () => void; let resume!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const primary = new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" });
    const outcome = host.query(undefined, undefined, async () => { started(); await gate; if (queryFails) throw primary; return "document"; })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await entered; await host.reload(); await host.reload(); assert.equal(db.closed, 0); resume();
      const result = await outcome;
      if (queryFails) { assert.ok("error" in result); assert.equal(result.error, primary); }
      else { assert.ok("value" in result); assert.equal(result.value, "document"); }
      assert.equal(db.closed, 1);
    } finally { resume(); await outcome;
      if (cleanupFails) await assert.rejects(host.close(), (error: unknown) => {
        assert.ok(error instanceof CapabilityGraphError); assert.equal(error.code, "CG_LOAD_FAILED");
        assert.deepEqual(error.details, { reason: "view_cleanup_failed", count: 1 });
        assert.doesNotMatch(JSON.stringify(error), /private cleanup secret/); return true;
      }); else await host.close();
    }
  });
}

test("R2: close reports direct failures and delayed final-pin failures without raw exceptions", async () => {
  for (const pinned of [false, true]) {
    const store = new ProviderViewStore(); const db = new FakeDatabase([record("a")]);
    db.close = async () => { db.closed++; throw new Error("private path"); };
    await store.replaceProvider(await databaseAuthorityStore(db, "seed"));
    const pin = pinned ? store.pin() : undefined;
    if (pin) { await store.close(); assert.equal(db.closed, 0); await pin.release(); await pin.release(); }
    else await assert.rejects(store.close(), code("CG_LOAD_FAILED"));
    await assert.rejects(store.close(), code("CG_LOAD_FAILED")); assert.equal(db.closed, 1);
  }
});

test("scope missing differs from explicit empty and query scope never expands", () => {
  assert.equal(computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: undefined, phase: "open" }).ok, false);
  const empty = computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: [], phase: "open" });
  assert.equal(empty.ok && empty.scope.size, 0);
  const denied = computeEffectiveScope({ hostAllowed: ["seed"], integrationEnabled: ["seed"], request: ["other"], phase: "query" });
  assert.equal(!denied.ok && denied.error.code, "CG_SCOPE_DENIED");
});

test("open is atomic across providers, distinguishes duplicates, and allows explicit empty", async () => {
  const db = new FakeDatabase([record("a")]);
  const base = config(async () => db);
  await assert.rejects(CoreHost.open({ ...base, providers: [...base.providers, ...base.providers] }), code("CG_DUAL_AUTHORITY"));
  await assert.rejects(CoreHost.open({ ...base, hostAllowedProviders: [] }), code("CG_SCOPE_DENIED"));
  const empty = await CoreHost.open({ hostAllowedProviders: ["seed"], integrationEnabledProviders: [], providers: [] });
  assert.deepEqual(await empty.query(undefined, undefined, async (ctx) => ctx.meta.scope), []); await empty.close();
  await assert.rejects(CoreHost.open({ ...base, hostAllowedProviders: ["seed", "other"], integrationEnabledProviders: ["seed", "other"],
    providers: [...base.providers, { providerId: "other", authority: { kind: "database", adapter: { id: "fail", openView: async () => { throw new Error("failed"); } } } }] }), code("CG_LOAD_FAILED"));
  assert.equal(db.closed, 1);
});

test("reload serializes and failed candidates preserve readable slots with refreshFailed", async () => {
  let version = 0;
  let fail = false;
  let opening = false;
  const host = await CoreHost.open(config(async () => {
    assert.equal(opening, false); opening = true; await new Promise((resolve) => setTimeout(resolve, 2)); opening = false;
    if (fail) throw new Error("failed");
    return new FakeDatabase([record("a", { name: String(++version) })]);
  }));
  const initial = await host.query(undefined, undefined, async (ctx) => ctx.meta.staticRevision!);
  await Promise.all([host.reload(), host.reload()]); assert.equal(version, 3);
  await assert.rejects(host.query(undefined, initial, async () => {}), code("CG_REVISION_MISMATCH"));
  const current = await host.query(undefined, undefined, async (ctx) => ctx.meta.staticRevision!);
  fail = true; const failed = await host.reload(); assert.equal(failed.ok, false);
  assert.equal(failed.providers[0]?.servedFrom, "current");
  await host.query(undefined, current, async (ctx) => { assert.equal(ctx.meta.refreshFailed, true); assert.equal(ctx.meta.servedFrom, "current"); });
  await host.close(); await assert.rejects(host.query(undefined, undefined, async () => {}), code("CG_NO_ACTIVE_VIEW"));
});

test("previous selection retains its knowledge root; dead backend maps to requested-view failure", async () => {
  const old = new FakeDatabase([record("a")]); old.knowledgeRootDir = "old-root";
  const oldRoot = path.resolve("old-root");
  let calls = 0;
  const host = await CoreHost.open(config(async () => ++calls === 1 ? old : new FakeDatabase([record("a", { name: "new" })])));
  const revision = await host.query(undefined, undefined, async (ctx) => ctx.meta.staticRevision!);
  await host.reload();
  await host.query(undefined, revision, async (ctx) => { assert.equal(ctx.meta.servedFrom, "previous"); assert.equal(ctx.graph.getView("seed")!.sourceContext.knowledgeRootDir, oldRoot); });
  old.getCapability = async () => { throw new Error("dead"); };
  await assert.rejects(host.query(undefined, revision, async (ctx) => ctx.graph.getView("seed")!.getCapability("a")), code("CG_REVISION_MISMATCH"));
  await host.close();
});
