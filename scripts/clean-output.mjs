import assert from "node:assert/strict";
import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";

/** Remove only a known build directory owned by this package, never an output symlink or an external path. */
export async function cleanOutput(packageRoot, name) {
  assert.ok(["dist", "dist-test"].includes(name), "Unknown build output");
  const root = await realpath(packageRoot);
  const output = path.join(root, name);
  assert.equal(path.dirname(output), root);
  const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (!existing) return;
  assert.ok(existing.isDirectory() && !existing.isSymbolicLink(), `${name} must be a package-owned directory`);
  assert.equal(await realpath(output), output);
  await rm(output, { recursive: true, force: true });
}
