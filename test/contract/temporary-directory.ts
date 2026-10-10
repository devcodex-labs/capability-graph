import assert from "node:assert/strict";
import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const helper = pathToFileURL(path.resolve(import.meta.dirname, "../../../scripts/lib/artifact-paths.mjs"));
const owned = new Map<string, { parent: string; prefix: string }>();

/** Persistent tests share the same outside-repository artifact policy as tools. */
export async function createTestDirectory(prefix: string): Promise<string> {
  const { createTemporaryDirectory } = await import(helper.href);
  const directory = await realpath(await createTemporaryDirectory(prefix));
  owned.set(directory, { parent: await realpath(path.dirname(directory)), prefix });
  return directory;
}

export async function removeTestDirectory(directory: string): Promise<void> {
  const ownership = owned.get(directory);
  assert(ownership, "refusing an unowned test directory");
  const entry = await lstat(directory);
  assert(entry.isDirectory() && !entry.isSymbolicLink(), "test directory must remain a real directory");
  assert.equal(await realpath(directory), directory);
  assert.equal(await realpath(path.dirname(directory)), ownership.parent);
  assert(path.basename(directory).startsWith(ownership.prefix));
  await rm(directory, { recursive: true, force: true });
  owned.delete(directory);
  await assert.rejects(realpath(directory), { code: "ENOENT" });
}
