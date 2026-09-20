import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileAuthorityStore } from "../src/store/file-authority-store.js";
import { validateSnapshot } from "../src/validate/index.js";
import { validateCapability, validateProvider } from "../src/validate/schema.js";
import { RECORD_MAX_BYTES } from "../src/validate/values.js";
import { assertProviderRelative, resolveProviderRelative } from "../src/knowledge/path-guard.js";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderSnapshot } from "../src/store/types.js";

const provider = { providerId: "seed.http", name: "Seed", version: "1" };
const row = (id: string, extra: object = {}): UnvalidatedCapabilityRecord => ({
  capabilityId: id, name: id, description: "Description", whenToUse: "When needed", ...extra,
});
const document = (knowledgeId = "D-01", file = "knowledge/missing.md") => ({
  kind: "document", knowledgeId, locator: { type: "relative-file", path: file },
});
const snapshot = (capabilities: readonly UnvalidatedCapabilityRecord[], root = process.cwd()): UnvalidatedProviderSnapshot => ({
  source: { kind: "file", rootDir: root }, knowledgeRootDir: root, provider, capabilities,
});

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "capability-graph-definitions-"));
  try { await run(root); } finally {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("capability-graph-definitions-"));
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  }
}

test("PR3: disk definitions load recursively, skip build/dependencies and never import application code", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, "provider.json"), JSON.stringify({ ...provider,
      specification: { specificationId: "rules", version: "1", entryRef: { type: "relative-file", path: "PROVIDER.md" } } }));
    await writeFile(path.join(root, "index.js"), "throw new Error('must never execute')");
    for (const dir of ["nested", "dist", "node_modules"]) await mkdir(path.join(root, dir));
    await writeFile(path.join(root, "nested", "z.capability.json"), JSON.stringify(row("z")));
    await writeFile(path.join(root, "a.capability.json"), JSON.stringify(row("a", { parents: ["z"], knowledge: [document()] })));
    await writeFile(path.join(root, "dist", "bad.capability.json"), "invalid");
    await writeFile(path.join(root, "node_modules", "bad.capability.json"), "invalid");
    const raw = await new FileAuthorityStore().load(root);
    const valid = await validateSnapshot(raw);
    assert.equal(raw.knowledgeRootDir, root);
    assert.deepEqual([...valid.capabilities.keys()], ["a", "z"]);
    assert.equal(valid.capabilities.get("a")!.knowledge[0]!.kind, "document");
    assert.deepEqual(valid.capabilities.get("a")!.parents, [{ providerId: "seed.http", capabilityId: "z" }]);
    assert.equal(valid.sourceContext.sourceRevision, valid.staticRevision);
    assert.ok(Object.isFrozen(valid.capabilities.get("a")!.parents));
  });
});

test("PR3: missing and malformed JSON return load failure without absolute paths", async () => {
  await fixture(async (root) => {
    await assert.rejects(new FileAuthorityStore().load(root), { code: "CG_LOAD_FAILED", details: { file: "provider.json" } });
    await writeFile(path.join(root, "provider.json"), JSON.stringify(provider));
    await writeFile(path.join(root, "bad.capability.json"), "{");
    await assert.rejects(new FileAuthorityStore().load(root), { code: "CG_LOAD_FAILED", details: { file: "bad.capability.json" } });
  });
});

test("file authority rejects oversized definitions before JSON parsing", async () => {
  for (const file of ["provider.json", "oversized.capability.json"]) await fixture(async (root) => {
    if (file !== "provider.json") await writeFile(path.join(root, "provider.json"), JSON.stringify(provider));
    await writeFile(path.join(root, file), "x".repeat(RECORD_MAX_BYTES + 1));
    await assert.rejects(new FileAuthorityStore().load(root), {
      code: "CG_BUDGET_EXCEEDED", details: { file, maxBytes: RECORD_MAX_BYTES },
    });
  });
});

test("deep R5: metadata and generated directories are excluded at every depth", async () => fixture(async (root) => {
  await writeFile(path.join(root, "provider.json"), JSON.stringify(provider));
  for (const prefix of ["", "nested"]) {
    for (const directory of [".git", "node_modules", "dist", "dist-test", "coverage", ".cache", ".tmp"]) {
      const target = path.join(root, prefix, directory, "objects"); await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "bad.capability.json"), "invalid");
    }
  }
  await writeFile(path.join(root, "nested/valid.capability.json"), JSON.stringify(row("nested")));
  await mkdir(path.join(root, "coverage-guide"));
  await writeFile(path.join(root, "coverage-guide/valid.capability.json"), JSON.stringify(row("guide")));
  const snapshot = await new FileAuthorityStore().load(root);
  assert.deepEqual(snapshot.capabilities.map((entry) => entry.capabilityId), ["guide", "nested"]);
}));

test("PR3: full endpoint set accepts forward references, multi-parent DAG and independent edge types", async () => {
  const valid = await validateSnapshot(snapshot([
    row("a", { parents: ["b", "z"], related: ["z"] }), row("b", { specializes: ["a"] }), row("z", { related: ["a"] }),
  ]));
  assert.equal(valid.capabilities.size, 3);
  assert.deepEqual(valid.capabilities.get("b")!.related, []);
  assert.deepEqual(valid.capabilities.get("z")!.knowledge, []);
});

test("PR3: duplicate and truly missing endpoints fail after complete collection", async () => {
  await assert.rejects(validateSnapshot(snapshot([row("a"), row("a")])), { code: "CG_VALIDATION_FAILED" });
  for (const relation of ["parents", "specializes", "related"]) {
    await assert.rejects(validateSnapshot(snapshot([row("a", { [relation]: ["z"] })])), {
      code: "CG_VALIDATION_FAILED", details: { endpoint: "z", relation },
    });
  }
});

for (const relation of ["parents", "specializes"]) {
  test(`PR3: ${relation} self, indirect and disconnected cycles fail`, async () => {
    for (const records of [[row("a", { [relation]: ["a"] })],
      [row("root"), row("a", { [relation]: ["z"] }), row("z", { [relation]: ["a"] })]]) {
      await assert.rejects(validateSnapshot(snapshot(records)), (error: unknown) =>
        (error as { code: string; details: { relation: string } }).code === "CG_RELATION_CYCLE" &&
        (error as { details: { relation: string } }).details.relation === relation);
    }
  });
}

test("PR3: qualified and object relation endpoints are never cross-provider lookups", async () => {
  for (const endpoint of ["monsqlize::query", { providerId: "seed.http", capabilityId: "z" }]) {
    await assert.rejects(validateCapability(row("a", { related: [endpoint] })), { code: "CG_RELATION_CROSS_PROVIDER" });
  }
  for (const endpoint of [12, null, [], "../x", ""]) {
    await assert.rejects(validateCapability(row("a", { related: [endpoint] })), { code: "CG_VALIDATION_FAILED" });
  }
});

test("PR3: reject unknown, missing and invalid fields including explicit null arrays", async () => {
  await assert.rejects(validateProvider({ ...provider, extra: true }), { code: "CG_VALIDATION_FAILED", details: { keys: ["extra"] } });
  await assert.rejects(validateProvider({ ...provider, providerId: "Seed" }), { code: "CG_IDENTITY_INVALID" });
  await assert.rejects(validateProvider({ ...provider, specification: { specificationId: "s", version: "1", appliesTo: { unknown: "x" } } }), { code: "CG_VALIDATION_FAILED" });
  for (const change of [{ unknown: 1 }, { name: null }, { whenToUse: "" }, { description: 2 }, { examples: [1] },
    ...["parents", "specializes", "related", "examples", "knowledge"].map((key) => ({ [key]: null }))]) {
    await assert.rejects(validateCapability(row("a", change)), { code: "CG_VALIDATION_FAILED" });
  }
  const { name: _name, ...missing } = row("a");
  await assert.rejects(validateCapability(missing), { code: "CG_VALIDATION_FAILED" });
  await assert.rejects(validateCapability(row("a", { description: "x".repeat(262_144) })), { code: "CG_BUDGET_EXCEEDED" });
});

test("PR3: knowledge uniqueness is local; shared collection members require identical locators", async () => {
  const root = process.cwd();
  const collection = (id: string, members: unknown[]) => ({ kind: "collection", knowledgeId: id, members });
  await validateSnapshot(snapshot([row("a", { knowledge: [document()] }), row("b", { knowledge: [document()] })]));
  await validateCapability(row("a", { knowledge: [collection("C1", [document()]), collection("C2", [document()])] }), root);
  await validateCapability(row("a", { knowledge: [collection("C1", [])] }), root);
  for (const knowledge of [[document(), document()], [collection("D-01", [document()])],
    [collection("C1", [document()]), collection("C2", [document("D-01", "other.md")])],
    [collection("C1", [collection("C2", [])])], [{ ...document(), extra: true }]]) {
    await assert.rejects(validateCapability(row("a", { knowledge }), root), { code: "CG_VALIDATION_FAILED" });
  }
});

test("PR3: relative-file requires an explicit root, HTTP declaration does not access network", async () => {
  await assert.rejects(validateCapability(row("a", { knowledge: [document()] })), {
    code: "CG_VALIDATION_FAILED", details: { reason: "relative_file_requires_knowledge_root" },
  });
  await validateCapability(row("a", { knowledge: [{ kind: "document", knowledgeId: "D-02",
    locator: { type: "http", url: "https://unreachable.invalid/knowledge" } }] }));
  await assert.rejects(validateCapability(row("a", { knowledge: [{ kind: "document", knowledgeId: "D-02",
    locator: { type: "http", url: "file:///secret" } }] })), { code: "CG_VALIDATION_FAILED" });
});

test("PR3: lexical escape rejection precedes I/O for knowledge, members and Specification", async () => {
  for (const relative of ["", "knowledge/../x.md", "../x.md", "knowledge/.", "./PROVIDER.md", "/x", "//host/x", "a\\x", "C:/x", "a:stream", "~/x", "a//b", "a/"]) {
    assert.throws(() => assertProviderRelative(relative), { code: "CG_PATH_TRAVERSAL" });
    await assert.rejects(validateCapability(row("a", { knowledge: [document("D1", relative)] }), "nonexistent-root"), { code: "CG_PATH_TRAVERSAL" });
  }
  await assert.rejects(validateProvider({ ...provider, specification: { specificationId: "s", version: "1",
    entryRef: { type: "relative-file", path: "./PROVIDER.md" } } }, "nonexistent-root"), { code: "CG_PATH_TRAVERSAL" });
  await assert.rejects(validateCapability(row("a", { knowledge: [{ kind: "collection", knowledgeId: "C1",
    members: [document("D1", "../x")] }] }), "nonexistent-root"), { code: "CG_PATH_TRAVERSAL" });
});

test("PR3: realpath rejects junction escape; missing body remains valid until read", async () => {
  await fixture(async (parent) => {
    const root = path.join(parent, "provider"); const outside = path.join(parent, "outside");
    await mkdir(root); await mkdir(outside); await writeFile(path.join(outside, "private.md"), "secret");
    await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(resolveProviderRelative(root, "linked/private.md"), { code: "CG_PATH_TRAVERSAL" });
    await validateCapability(row("a", { knowledge: [document()] }), root);
    await assert.rejects(resolveProviderRelative(root, "knowledge/missing.md", true), { code: "CG_SOURCE_UNREADABLE" });
  });
});

test("PR3: iterative cycle detection handles deep graphs and revision ignores source order", async () => {
  const id = (index: number) => `n${String(index).padStart(5, "0")}`;
  const records = Array.from({ length: 2000 }, (_, index) => row(id(index), { parents: index < 1999 ? [id(index + 1)] : [] }));
  const first = await validateSnapshot(snapshot(records));
  const second = await validateSnapshot(snapshot([...records].reverse()));
  assert.equal(first.staticRevision, second.staticRevision);
});
