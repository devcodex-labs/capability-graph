import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as library from "@devcodex/capability-graph";

test("T-F09: the built ESM package imports through its public entry", () => {
  assert.equal(typeof library, "object");
});

test("T-F09: package metadata declares four public entries, CLI lifecycle and pinned dependencies", async () => {
  const metadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(metadata.exports), [".", "./mcp", "./mcp/server", "./readers/http"]);
  assert.deepEqual(metadata.dependencies, { "@modelcontextprotocol/server": "2.0.0", "@modelcontextprotocol/node": "2.0.0", "@modelcontextprotocol/client": "2.0.0", "ajv": "8.17.1", "toml-eslint-parser": "0.10.1", "bcp-47": "2.1.1", "language-subtag-registry": "0.4.2" });
  assert.equal(metadata.license, "Apache-2.0");
  assert.deepEqual(metadata.files, ["dist", "scripts/postinstall.mjs", "README.md", "LICENSE"]);
  assert.deepEqual(metadata.bin, { "capability-graph": "./dist/cli/main.js" });
  assert.equal(metadata.scripts.postinstall, "node scripts/postinstall.mjs");
});
