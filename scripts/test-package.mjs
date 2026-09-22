import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check with npm run test:package");
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, "capability-graph-package-"));
const command = (args, cwd = repository) => execFileSync(process.execPath, args, {
  cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
});

try {
  const snapshot = path.join(temporary, "source"); await mkdir(snapshot);
  for (const entry of ["package.json", "package-lock.json", "README.md", "LICENSE", "tsconfig.json", "src", "scripts", "node_modules"]) {
    await cp(path.join(repository, entry), path.join(snapshot, entry), { recursive: true });
  }
  await assert.rejects(realpath(path.join(snapshot, "dist")), { code: "ENOENT" });
  const [packed] = JSON.parse(command([npm, "pack", "--json", "--offline", "--pack-destination", temporary], snapshot));
  const prebuiltDestination = path.join(temporary, "prebuilt"); await mkdir(prebuiltDestination);
  const [prebuilt] = JSON.parse(command([npm, "pack", "--json", "--ignore-scripts", "--pack-destination", prebuiltDestination]));
  assert.deepEqual(packed.files, prebuilt.files);
  for (const file of packed.files.filter((file) => file.path.startsWith("dist/"))) {
    assert.deepEqual(await readFile(path.join(snapshot, file.path)), await readFile(path.join(repository, file.path)));
  }
  await writeFile(path.join(snapshot, "dist/stale.js"), "throw new Error('deleted module');");
  await writeFile(path.join(snapshot, "dist/index.js"), "throw new Error('outdated entry');");
  const [rebuilt] = JSON.parse(command([npm, "pack", "--json", "--offline", "--pack-destination", temporary], snapshot));
  assert.deepEqual(rebuilt.files, packed.files);
  assert.deepEqual(await readFile(path.join(snapshot, "dist/index.js")), await readFile(path.join(repository, "dist/index.js")));
  await assert.rejects(realpath(path.join(snapshot, "dist/stale.js")), { code: "ENOENT" });
  console.log("Clean-source standard pack and stale-output rebuild passed (offline, no dist copied)");
  for (const file of packed.files) {
    assert.ok(["package.json", "README.md", "LICENSE"].includes(file.path) || file.path.startsWith("dist/"),
      `Unexpected package file: ${file.path}`);
  }
  assert.ok(packed.files.some((file) => file.path === "dist/index.d.ts"));
  assert.ok(packed.files.some((file) => file.path === "dist/index.js"));
  await writeFile(path.join(temporary, "package.json"), JSON.stringify({ name: "isolated-consumer", private: true, type: "module" }));
  command([npm, "install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
    path.join(temporary, packed.filename)], temporary);
  const installed = path.join(temporary, "node_modules", "@devcodex", "capability-graph");
  const metadata = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(metadata.exports), ["."]);
  assert.deepEqual(metadata.dependencies, { "bcp-47": "2.1.1", "language-subtag-registry": "0.4.2" });
  for (const file of packed.files.filter((item) => item.path.endsWith(".js"))) {
    assert.doesNotMatch(await readFile(path.join(installed, file.path), "utf8"), /@modelcontextprotocol|fixture-runtime-adapter|fake-.*retriever/);
  }
  const output = command(["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    import { fileURLToPath } from 'node:url';
    import * as api from '@devcodex/capability-graph';
    assert.equal(fileURLToPath(import.meta.resolve('@devcodex/capability-graph')), ${JSON.stringify(path.join(installed, "dist/index.js"))});
    assert.deepEqual(api.parseQualifiedId('seed.http::route.http'), {providerId:'seed.http', capabilityId:'route.http'});
    assert.equal(api.computeStaticRevision, undefined);
    assert.equal(api.resolveBudgets, undefined);
    assert.equal(api.bindCapabilityId, undefined);
    await assert.rejects(import('@devcodex/capability-graph/mcp'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    await assert.rejects(import('@devcodex/capability-graph/hash'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    console.log('Installed tarball runtime checks passed');
  `], temporary);
  await copyFile(path.join(repository, "test/consumer/public-api.ts"), path.join(temporary, "consumer.ts"));
  await writeFile(path.join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "Node16", moduleResolution: "Node16", strict: true,
    noUncheckedIndexedAccess: true, noEmit: true, types: [],
  }, include: ["consumer.ts"] }));
  command([path.join(repository, "node_modules/typescript/bin/tsc"), "-p", path.join(temporary, "tsconfig.json")], temporary);
  console.log(output.trim());
  console.log(`Package boundary: ${packed.files.length} files; isolated declarations passed on ${process.version}`);
} finally {
  // Delete only the unique directory created by this invocation, never a caller path.
  assert.equal(path.dirname(temporary), temporaryRoot);
  assert.ok(path.basename(temporary).startsWith("capability-graph-package-"));
  assert.equal(await realpath(temporary), temporary);
  await rm(temporary, { recursive: true, force: true });
  await assert.rejects(realpath(temporary), { code: "ENOENT" });
  console.log("Temporary consumer cleanup verified");
}
