import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const compilerOptions = { target: "ES2022", module: "Node16", moduleResolution: "Node16", types: ["node"], strict: true, skipLibCheck: true };
async function fixture(run: (root: string, links: string[]) => Promise<void>) {
  const parent = await realpath(tmpdir()); const root = await mkdtemp(path.join(parent, "capability-graph-build-"));
  const links: string[] = [];
  try { await run(root, links); }
  finally {
    // Detach only fixture junctions; recursive removal must never traverse the real dependency tree.
    for (const link of links) {
      assert.ok(link.startsWith(`${root}${path.sep}`)); assert.ok((await lstat(link)).isSymbolicLink()); await unlink(link);
    }
    assert.equal(path.dirname(root), parent); assert.equal(await realpath(root), root);
    assert.ok(path.basename(root).startsWith("capability-graph-build-")); await rm(root, { recursive: true, force: true });
  }
}
async function copyScript(root: string, file: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await copyFile(path.join(repository, file), path.join(root, file));
}
async function dependencies(root: string, links: string[]) {
  const link = path.join(root, "node_modules");
  await symlink(path.join(repository, "node_modules"), link, process.platform === "win32" ? "junction" : "dir"); links.push(link);
}
function command(args: string[], cwd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
  // This fixture starts an independent test runner, not another child of the outer runner.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024,
    env });
  assert.ifError(result.error); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("deep R6: standard npm test cleans orphaned tests before discovery", async () => fixture(async (root, links) => {
  for (const file of ["scripts/build.mjs", "scripts/build-tests.mjs", "scripts/clean-output.mjs", "scripts/run-tests.mjs"]) await copyScript(root, file);
  for (const directory of ["src", "test", "dist", "dist-test/test"]) await mkdir(path.join(root, directory), { recursive: true });
  await dependencies(root, links);
  const metadata = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "build-fixture", private: true, type: "module", scripts: metadata.scripts }));
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, rootDir: "src", outDir: "dist" }, include: ["src"] }));
  await writeFile(path.join(root, "tsconfig.test.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, rootDir: ".", outDir: "dist-test" }, include: ["test"] }));
  await writeFile(path.join(root, "tsconfig.consumer.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: true }, include: ["src"] }));
  await writeFile(path.join(root, "src/index.ts"), "export {};\n");
  await writeFile(path.join(root, "test/active.test.ts"), "import { test } from 'node:test'; test('active source test', () => {});\n");
  await writeFile(path.join(root, "dist/stale.js"), "throw new Error('stale build');\n");
  await writeFile(path.join(root, "dist-test/test/deleted.test.js"), "throw new Error('deleted test must not run');\n");
  const npm = process.env.npm_execpath; assert.ok(npm, "Run regression through npm test");
  const output = command([npm, "test"], root);
  assert.match(output, /active source test/); assert.match(output, /# tests 1\b/);
  for (const file of ["dist/stale.js", "dist-test/test/deleted.test.js"]) await assert.rejects(lstat(path.join(root, file)), { code: "ENOENT" });
  assert.ok((await lstat(path.join(root, "dist-test/test/active.test.js"))).isFile());
}));

test("deep R6: private MCP build also removes orphaned output", async () => fixture(async (root, links) => {
  await copyScript(root, "scripts/clean-output.mjs"); await copyScript(root, "examples/seed-mcp/scripts/build.mjs");
  const target = path.join(root, "examples/seed-mcp");
  for (const directory of ["src", "dist"]) await mkdir(path.join(target, directory), { recursive: true });
  await dependencies(target, links);
  const metadata = JSON.parse(await readFile(path.join(repository, "examples/seed-mcp/package.json"), "utf8"));
  await writeFile(path.join(target, "package.json"), JSON.stringify({ name: "mcp-build-fixture", private: true, type: "module", scripts: metadata.scripts }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(path.join(target, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...compilerOptions, rootDir: ".", outDir: "dist" }, include: ["src"] }));
  await writeFile(path.join(target, "src/main.ts"), "export {};\n"); await writeFile(path.join(target, "dist/stale.js"), "throw new Error('orphan');\n");
  const npm = process.env.npm_execpath; assert.ok(npm);
  command([npm, "run", "build"], target);
  await assert.rejects(lstat(path.join(target, "dist/stale.js")), { code: "ENOENT" });
  assert.ok((await lstat(path.join(target, "dist/src/main.js"))).isFile());
}));

for (const name of ["dist", "dist-test"]) {
  test(`deep R6: cleanup refuses ${name} symlinks, files and unknown targets`, async () => fixture(async (root, links) => {
    const { cleanOutput } = await import(pathToFileURL(path.join(repository, "scripts/clean-output.mjs")).href);
    const outside = path.join(root, "retained"); await mkdir(outside);
    await writeFile(path.join(outside, "keep.txt"), "keep");
    const target = path.join(root, name); await symlink(outside, target, process.platform === "win32" ? "junction" : "dir"); links.push(target);
    await assert.rejects(cleanOutput(root, name));
    assert.equal(await readFile(path.join(outside, "keep.txt"), "utf8"), "keep");
    await unlink(target); links.pop(); await writeFile(target, "not a directory");
    await assert.rejects(cleanOutput(root, name)); assert.equal(await readFile(target, "utf8"), "not a directory");
    await assert.rejects(cleanOutput(root, "../retained"));
  }));
}
