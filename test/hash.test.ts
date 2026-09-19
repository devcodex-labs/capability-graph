import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalJson, computeStaticRevision } from "../src/hash.js";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderRecord } from "../src/store/types.js";

const provider: UnvalidatedProviderRecord = { providerId: "seed.http", name: "Seed", version: "1" };
const row = (capabilityId: string): UnvalidatedCapabilityRecord => ({
  capabilityId, name: "Route", description: "HTTP request handling", whenToUse: "Add a route",
});

// A separate whole-document oracle intentionally does not use canonicalJson.
function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => [key, orderedJson(entry)]));
  return value;
}

function referenceHash(records: readonly UnvalidatedCapabilityRecord[], source = provider): string {
  const document = { capabilities: records.map((item) => ({ ...item, distinction: item.distinction ?? null,
    examples: item.examples ?? [], parents: item.parents ?? [], specializes: item.specializes ?? [],
    related: item.related ?? [], knowledge: item.knowledge ?? [] })),
  provider: { providerId: source.providerId, name: source.name, version: source.version, specification: source.specification } };
  return `s:${createHash("sha256").update(JSON.stringify(orderedJson(document)), "utf8").digest("hex").slice(0, 16)}`;
}

async function* pages(records: readonly UnvalidatedCapabilityRecord[], pageSize: number) {
  for (let offset = 0; offset < records.length; offset += pageSize) {
    const page = records.slice(offset, offset + pageSize);
    await Promise.resolve();
    yield* page;
  }
}

for (const size of [0, 3, 103]) {
  for (const pageSize of [1, 2, 100]) {
    test(`T-F12: ${size} rows at page size ${pageSize} match the whole-document oracle`, async () => {
      const records = Array.from({ length: size }, (_, index) => row(`route.${String(index).padStart(3, "0")}`));
      const expected = referenceHash(records);
      assert.equal(await computeStaticRevision(provider, records), expected);
      assert.equal(await computeStaticRevision(provider, pages(records, pageSize)), expected);
    });
  }
}

test("T-F12: Unicode, escaping, object order and omitted defaults are deterministic", async () => {
  const special = { ...row("route"), description: "\u4e2d\u6587 \"quote\"\\\n", examples: ["\ud83d\ude00", "\u00e9", "e\u0301"] };
  assert.equal(await computeStaticRevision(provider, [special]), referenceHash([special]));
  const shuffled = Object.fromEntries(Object.entries(special).reverse()) as unknown as UnvalidatedCapabilityRecord;
  assert.equal(await computeStaticRevision(provider, [shuffled]), await computeStaticRevision(provider, [special]));
  assert.equal(await computeStaticRevision(provider, [row("route")]),
    await computeStaticRevision(provider, [{ ...row("route"), examples: [], parents: [], related: [], specializes: [], knowledge: [] }]));
  assert.notEqual(canonicalJson("\u00e9"), canonicalJson("e\u0301"));
  assert.notEqual(canonicalJson(["a", "b"]), canonicalJson(["b", "a"]));
});

test("T-F12: each formal field changes the revision", async () => {
  const base = row("route");
  const baseline = await computeStaticRevision(provider, [base]);
  for (const change of [{ providerId: "other" }, { name: "Other" }, { version: "2" },
    { specification: { specificationId: "rules", version: "1", appliesTo: { conditions: "HTTP" } } }]) {
    assert.notEqual(await computeStaticRevision({ ...provider, ...change }, [base]), baseline);
  }
  for (const change of [{ capabilityId: "other" }, { name: "Other" }, { description: "Other" },
    { whenToUse: "Other" }, { distinction: "Other" }, { examples: ["Other"] },
    { parents: ["parent"] }, { specializes: ["parent"] }, { related: ["other"] },
    { knowledge: [{ kind: "document", knowledgeId: "D-02", locator: { type: "relative-file", path: "knowledge/a.md" } }] }]) {
    assert.notEqual(await computeStaticRevision(provider, [{ ...base, ...change }]), baseline);
  }
});

test("T-F12: source identity, authority, knowledge root and body stay outside static hashing", async () => {
  const baseline = await computeStaticRevision(provider, [row("route")]);
  const source = { ...provider, authorityKind: "database", sourceRevision: "db2", knowledgeRootDir: "D:/private" };
  const record = { ...row("route"), body: "changed body", contentId: "k:2", rootDir: "D:/other" };
  assert.equal(await computeStaticRevision(source, [record]), baseline);
});

test("T-F12: duplicate or out-of-order records abort the candidate", async () => {
  for (const records of [[row("b"), row("a")], [row("a"), row("a")]]) {
    await assert.rejects(computeStaticRevision(provider, pages(records, 1)), {
      code: "CG_VALIDATION_FAILED", details: { reason: "capability_order_invalid" },
    });
  }
});

test("T-F12: an interrupted source cannot return a prefix revision", async () => {
  const failure = new Error("view expired");
  async function* broken() { yield row("a"); throw failure; }
  await assert.rejects(computeStaticRevision(provider, broken()), (error) => error === failure);
});

test("T-F12: streaming reuses one record object without retaining definitions", async () => {
  const mutable = { ...row("a") };
  async function* source() {
    yield mutable;
    mutable.capabilityId = "b";
    yield mutable;
  }
  assert.equal(await computeStaticRevision(provider, source()), referenceHash([row("a"), row("b")]));
});

test("canonical JSON rejects non-JSON values, holes, cycles and executable accessors", () => {
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), /x/, () => 1, [undefined], new Array(1), cycle]) {
    assert.throws(() => canonicalJson(value), { code: "CG_VALIDATION_FAILED" });
  }
  let called = false;
  assert.throws(() => canonicalJson({ get data() { called = true; return 1; } }), { code: "CG_VALIDATION_FAILED" });
  assert.throws(() => canonicalJson({ toJSON() { called = true; return {}; } }), { code: "CG_VALIDATION_FAILED" });
  assert.equal(called, false);
  const shared = { a: 1 };
  assert.equal(canonicalJson([shared, shared]), '[{"a":1},{"a":1}]');
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
  assert.equal(canonicalJson(Object.assign(Object.create(null), { z: 2, a: 1 })), '{"a":1,"z":2}');
});
