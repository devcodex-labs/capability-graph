import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, writeFile, rename, symlink } from "node:fs/promises";
import { CapabilityGraph, CapabilityGraphError, type KnowledgeDocumentRef, type OpenConfig } from "../src/index.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";
const configuration = (root: string, layout?: "directory" | "legacy", knowledgeRoots?: OpenConfig["providers"][number]["knowledgeRoots"]): OpenConfig => ({
  hostAllowedProviders: ["seed"], integrationEnabledProviders: ["seed"], providers: [{ providerId: "seed", knowledgeRoots,
    authority: { kind: "file", rootDir: root, ...(layout === undefined ? {} : { definitionLayout: layout }) } }],
});
async function fixture(run: (root: string) => Promise<void>) {
  const root = await createTestDirectory("provider-layout-");
  try { await writeFile(path.join(root, "provider.json"), JSON.stringify({ providerId: "seed", name: "Seed", version: "1" })); await run(root); }
  finally { await removeTestDirectory(root); }
}
const capability = (knowledge: readonly KnowledgeDocumentRef[] = []) => ({ capabilityId: "a", name: "A", description: "Source", whenToUse: "When needed", knowledge });
test("explicit directory layout ignores unrelated JSON, preserves identity across legacy rename", async () => fixture(async (root) => {
  await mkdir(path.join(root, "capabilities")); await mkdir(path.join(root, "knowledge"));
  await writeFile(path.join(root, "knowledge", "catalog.json"), "{}");
  await writeFile(path.join(root, "a.capability.json"), JSON.stringify(capability()));
  const old = await CapabilityGraph.open(configuration(root)); const revision = (await old.getProvider("seed")).staticRevision; await old.close();
  await rename(path.join(root, "a.capability.json"), path.join(root, "capabilities", "different-name.json"));
  const graph = await CapabilityGraph.open(configuration(root, "directory"));
  try { assert.equal((await graph.getProvider("seed")).staticRevision, revision); assert.equal((await graph.listCatalog()).items.length, 1); }
  finally { await graph.close(); }
}));
test("directory mode diagnoses missing folder, mixed layout, nested manifest, invalid JSON and case conflicts", async () => {
  for (const problem of ["missing", "mixed", "nested", "malformed", "case", "bare"]) await fixture(async (root) => {
    if (problem !== "missing") await mkdir(path.join(root, "capabilities"));
    if (problem === "mixed") await writeFile(path.join(root, "a.capability.json"), JSON.stringify(capability()));
    if (problem === "nested") { await mkdir(path.join(root, "nested")); await writeFile(path.join(root, "nested", "provider.json"), "{}"); }
    if (problem === "malformed") await writeFile(path.join(root, "capabilities", "a.json"), "{}");
    if (problem === "case") { await writeFile(path.join(root, "capabilities", "A.json"), "{}"); await writeFile(path.join(root, "capabilities", "a.json"), "{}"); }
    if (problem === "bare") await writeFile(path.join(root, "capability.json"), JSON.stringify(capability()));
    await assert.rejects(CapabilityGraph.open(configuration(root, problem === "bare" ? "legacy" : "directory")), (error: unknown) => error instanceof CapabilityGraphError);
  });
});
test("empty directory and provider-only legacy are valid empty providers", async () => fixture(async (root) => {
  for (const layout of ["legacy", "directory"] as const) {
    if (layout === "directory") await mkdir(path.join(root, "capabilities"));
    const graph = await CapabilityGraph.open(configuration(root, layout));
    try { assert.equal((await graph.listCatalog()).items.length, 0); } finally { await graph.close(); }
  }
}));
test("bound directory and scoped pnpm package roots allow Unicode/spaces while retaining private boundaries", async () => fixture(async (root) => {
  const definitions = path.join(root, "definitions"); const docs = path.join(root, "正式 文档"); const app = path.join(root, "application");
  const installed = path.join(app, "node_modules", ".pnpm", "scoped-lib", "node_modules", "@scope", "lib");
  await mkdir(path.join(definitions, "capabilities"), { recursive: true }); await mkdir(docs); await mkdir(installed, { recursive: true });
  await writeFile(path.join(definitions, "provider.json"), JSON.stringify({ providerId: "seed", name: "Seed", version: "1" }));
  await writeFile(path.join(docs, "中文 guide.mdx"), "Official 中文🙂"); await writeFile(path.join(installed, "README.md"), "Installed package");
  await writeFile(path.join(installed, "package.json"), JSON.stringify({ name: "@scope/lib", version: "1.2.3", exports: { ".": "./entry.js" } }));
  await mkdir(path.join(app, "node_modules", "@scope")); await symlink(installed, path.join(app, "node_modules", "@scope", "lib"), process.platform === "win32" ? "junction" : "dir");
  const refs: KnowledgeDocumentRef[] = [{ kind: "document", knowledgeId: "official", role: "guide", locator: { type: "relative-file", root: "docs", path: "中文 guide.mdx" } },
    { kind: "document", knowledgeId: "installed", role: "guide", locator: { type: "relative-file", root: "package", path: "README.md" } }];
  await writeFile(path.join(definitions, "capabilities", "a.json"), JSON.stringify(capability(refs)));
  const graph = await CapabilityGraph.open(configuration(definitions, "directory", { docs: { kind: "directory", rootDir: docs }, package: { kind: "package", packageName: "@scope/lib", resolveFrom: app } }));
  try {
    const read = await graph.readDocuments({ selected: [{ providerId: "seed", capabilityId: "a" }] });
    assert.ok(read.results.every((item) => item.ok)); assert.equal(JSON.stringify(read).includes(root), false);
    assert.deepEqual(read.results.map((item) => item.ok && item.value.source), ["root:package/README.md", "root:docs/中文 guide.mdx"]);
    await symlink(root, path.join(docs, "escape"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(path.join(definitions, "capabilities", "a.json"), JSON.stringify(capability([{ ...refs[0]!, locator: { type: "relative-file", root: "docs", path: "escape/provider.json" } }])));
    const reload = await graph.reload(); assert.equal(reload.ok, false); assert.equal(reload.providers[0]?.error?.code, "CG_PATH_TRAVERSAL");
    await writeFile(path.join(installed, "package.json"), JSON.stringify({ name: "@scope/lib", version: "2.0.0" }));
    const changed = await graph.readDocuments({ selected: [{ providerId: "seed", capabilityId: "a" }], knowledgeIds: ["installed"] });
    assert.ok(!changed.results[0]!.ok); assert.equal(changed.results[0]!.error.code, "CG_SOURCE_UNREADABLE"); assert.equal(JSON.stringify(changed).includes(root), false);
  } finally { await graph.close(); }
}));
