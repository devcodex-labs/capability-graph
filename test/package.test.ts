import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as library from "@devcodex/capability-graph";

test("T-F09: the built ESM package imports through its public entry", () => {
  assert.equal(typeof library, "object");
});

test("T-F09: package metadata keeps the root-only, dependency-free boundary", async () => {
  const metadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(metadata.exports), ["."]);
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.equal(metadata.license, "Apache-2.0");
  assert.deepEqual(metadata.files, ["dist", "README.md", "LICENSE"]);
});
