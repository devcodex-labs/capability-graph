import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const output = path.join(repository, "dist");
assert.equal(path.dirname(output), repository);
const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
// A clean build cannot package deleted source modules; never follow an output symlink.
if (existing) {
  assert.ok(existing.isDirectory() && !existing.isSymbolicLink(), "dist must be a repository-owned directory");
  assert.equal(await realpath(output), output);
  await rm(output, { recursive: true, force: true });
}
const result = spawnSync(process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
  cwd: repository, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
