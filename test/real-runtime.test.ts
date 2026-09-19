import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { CapabilityGraph, CapabilityGraphError, type RuntimeAdapter } from "@devcodex-labs/capability-graph";
import { HttpRuntimeAdapter } from "../examples/seed-runtime/adapter.js";
import { runSeedTask, seedProviderRoot } from "../examples/seed-api/main.js";
import { launchService, assertPortReleased } from "./contract/http-service-process.js";

const scope = { project: "app-a", environment: "test" };
const code = (value: string) => (error: unknown) => error instanceof CapabilityGraphError && error.code === value;
const open = (adapter?: RuntimeAdapter) => CapabilityGraph.open({ hostAllowedProviders: ["seed.http"], integrationEnabledProviders: ["seed.http"],
  providers: [{ providerId: "seed.http", authority: { kind: "file", rootDir: seedProviderRoot } }], runtimeAdapters: adapter ? [adapter] : [] });
async function staticRevision() { const graph = await open(); try { return (await graph.getProvider("seed.http")).staticRevision; } finally { await graph.close(); } }
const adapterAt = (url: string, extra: { timeoutMs?: number; maxBytes?: number } = {}) => new HttpRuntimeAdapter({ endpoint: `${url}/__capabilities/runtime`, ...extra });

test("R5: malformed request targets return 400 without terminating business or discovery service", async (context) => {
  const service = await launchService({ ...scope, staticRevision: await staticRevision(), buildId: "malformed-target" }, context);
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: service.port, path: "http://[", method: "GET", agent: false }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode));
      });
      req.setTimeout(2000, () => req.destroy(new Error("request timeout"))); req.on("error", reject); req.end();
    });
    assert.equal(status, 400);
    const response = await fetch(`${service.url}/users`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { users: [], ...scope });
    const graph = await open(adapterAt(service.url));
    try { assert.equal((await graph.queryRuntime(scope)).items.length, 2); } finally { await graph.close(); }
    assert.doesNotThrow(() => process.kill(service.pid, 0));
  } finally { await service.stop(); }
});

test("F-18 real: independent HTTP dispatch, discovered instances and selected knowledge complete the task", async (context) => {
  const service = await launchService({ ...scope, staticRevision: await staticRevision(), buildId: "build-1" }, context);
  try {
    const started = performance.now();
    const response = await fetch(`${service.url}/users`, { method: "POST", signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 201); assert.deepEqual(await response.json(), { created: true, ...scope });
    const result = await runSeedTask({ runtime: { adapter: adapterAt(service.url), ...scope } });
    assert.equal(result.catalog.items.length, 5);
    assert.deepEqual(result.runtime?.items.map((item) => item.instanceId), ["GET /users", "POST /users"]);
    assert.equal(result.runtime?.observation.compatibility, "compatible");
    assert.equal(result.runtime?.observation.freshness, "current");
    assert.match(result.runtime!.observation.sourceIdentity!, new RegExp(`^seed-http:${service.pid}:`));
    assert.deepEqual(result.documents.results.map((entry) => entry.ok ? entry.value.knowledgeId : entry.error.code), ["D-02", "D-03"]);
    context.diagnostic(JSON.stringify({ evaluation: "F-18 actual HTTP source", node: process.version, staticRevision: result.catalog.meta.staticRevision,
      queryCalls: 6, businessHttpCalls: 1, runtimeHttpCalls: 1, missingInstances: 0, missingDocuments: 0, unexpectedDocuments: 0,
      responseBytes: Object.fromEntries(["catalog", "detail", "neighbors", "runtime", "documents"].map((key) => [key, Buffer.byteLength(JSON.stringify(result[key as keyof typeof result]))])),
      elapsedMs: Number((performance.now() - started).toFixed(3)), modelCalls: 0, retrievalComparison: "N/A" }));
  } finally { await service.stop(); }
});

test("F-18 real: project/environment source identity is isolated and mismatched queries are not empty", async (context) => {
  const revision = await staticRevision();
  const a = await launchService({ ...scope, staticRevision: revision, buildId: "a" }, context);
  let b: Awaited<ReturnType<typeof launchService>> | undefined;
  try {
    b = await launchService({ project: "app-b", environment: "production", staticRevision: revision, buildId: "b" }, context);
    const ga = await open(adapterAt(a.url)); const gb = await open(adapterAt(b.url));
    try {
      const one = await ga.queryRuntime(scope); const two = await gb.queryRuntime({ project: "app-b", environment: "production" });
      assert.notEqual(one.observation.sourceIdentity, two.observation.sourceIdentity);
      assert.ok(one.items.every((item) => item.project === "app-a" && item.environment === "test"));
      assert.ok(two.items.every((item) => item.project === "app-b" && item.environment === "production"));
      await assert.rejects(ga.queryRuntime({ ...scope, project: "app-b" }), code("CG_RUNTIME_UNAVAILABLE"));
      await assert.rejects(ga.queryRuntime({ ...scope, environment: "production" }), code("CG_RUNTIME_UNAVAILABLE"));
    } finally { await ga.close(); await gb.close(); }
  } finally { await b?.stop(); await a.stop(); }
});

test("F-18 real: fresh collection, revision-bound pagination and genuine filtered emptiness", async (context) => {
  const service = await launchService({ ...scope, staticRevision: await staticRevision(), buildId: "live" }, context);
  try {
    const graph = await open(adapterAt(service.url));
    try {
      const first = await graph.queryRuntime({ ...scope, limit: 1 }); assert.ok(first.nextCursor);
      const second = await graph.queryRuntime({ ...scope, limit: 1, cursor: first.nextCursor });
      assert.equal(second.items[0]?.instanceId, "POST /users"); assert.equal(second.nextCursor, undefined);
      await service.register("GET", "/health");
      const actual = await fetch(`${service.url}/health`, { signal: AbortSignal.timeout(2000) }); assert.equal(actual.status, 200); await actual.text();
      const changed = await graph.queryRuntime(scope); assert.equal(changed.items.length, 3);
      assert.notEqual(changed.observation.runtimeRevision, first.observation.runtimeRevision);
      await assert.rejects(graph.queryRuntime({ ...scope, limit: 1, cursor: first.nextCursor }), code("CG_REVISION_MISMATCH"));
      await assert.rejects(graph.queryRuntime({ ...scope, requiredRuntimeRevision: first.observation.runtimeRevision }), code("CG_REVISION_MISMATCH"));
      const empty = await graph.queryRuntime({ ...scope, instanceId: "GET /absent" });
      assert.deepEqual(empty.items, []); assert.equal(empty.observation.availability, "empty");
      assert.equal((await graph.listCatalog()).items.length, 5);
    } finally { await graph.close(); }
  } finally { await service.stop(); }
});

test("F-18 real: an older build remains unknown, not rewritten to the querying static revision", async (context) => {
  const service = await launchService({ ...scope, staticRevision: "s:older-deployment", buildId: "old-build" }, context);
  try {
    const graph = await open(adapterAt(service.url));
    try {
      const page = await graph.queryRuntime(scope);
      assert.equal(page.observation.observedAgainstStaticRevision, "s:older-deployment");
      assert.equal(page.observation.compatibility, "unknown"); assert.equal(page.observation.freshness, "current");
      assert.ok(page.items.every((item) => item.facts.buildId === "old-build"));
      assert.notEqual(page.meta.view?.runtime?.queriedStaticRevision, page.observation.observedAgainstStaticRevision);
    } finally { await graph.close(); }
  } finally { await service.stop(); }
});

test("F-18 real: source outage is unavailable and the same adapter recovers after restart", async (context) => {
  const revision = await staticRevision();
  const original = await launchService({ ...scope, staticRevision: revision, buildId: "restart" }, context);
  const graph = await open(adapterAt(original.url)); let replacement: Awaited<ReturnType<typeof launchService>> | undefined;
  try {
    const before = await graph.queryRuntime(scope); await original.stop();
    await assert.rejects(graph.queryRuntime(scope), code("CG_RUNTIME_UNAVAILABLE"));
    assert.equal((await graph.listCatalog()).items.length, 5);
    replacement = await launchService({ ...scope, staticRevision: revision, buildId: "restart", port: original.port }, context);
    const after = await graph.queryRuntime(scope); assert.equal(after.items.length, 2);
    assert.notEqual(before.observation.runtimeRevision, after.observation.runtimeRevision);
  } finally { await graph.close(); await replacement?.stop(); await original.stop(); }
});

test("HTTP adapter negative transport probes: redirects, invalid JSON, byte cap and absolute deadline", async (context) => {
  for (const mode of ["redirect", "invalid", "large", "hang"] as const) {
    const server = createServer((_request, response) => {
      if (mode === "hang") return;
      if (mode === "redirect") { response.writeHead(302, { location: "http://127.0.0.1:1/private" }); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json" }); response.end(mode === "invalid" ? "not-json" : JSON.stringify({ text: "x".repeat(10000) }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const graph = await open(adapterAt(`http://127.0.0.1:${address.port}`, { timeoutMs: 40, maxBytes: 100 }));
    try {
      const started = performance.now();
      await assert.rejects(graph.queryRuntime(scope), code("CG_RUNTIME_UNAVAILABLE"));
      assert.ok(performance.now() - started < 2000, "The HTTP adapter must settle without waiting for Core's 5s fallback");
    }
    finally {
      await graph.close(); await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await assertPortReleased(address.port); context.diagnostic(`transport probe=${mode} PID=${process.pid} port=${address.port} released`);
    }
  }
  assert.throws(() => adapterAt("http://example.com"));
});
