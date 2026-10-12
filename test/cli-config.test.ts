import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { normalizeConfig, loadConfig, saveConfig, openConfigured, configPath } from "../src/cli/config.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

test("CLI config is strict, bounded, source-relative and legal with an empty Provider list", async () => {
  const root = await createTestDirectory("cli-config-"); const file = path.join(root, "config.json");
  try {
    const input = { schemaVersion: 1, providers: [{ providerId: "seed", authority: { kind: "file", rootDir: "provider", definitionLayout: "directory" },
      knowledgeRoots: { docs: { kind: "directory", rootDir: "../docs" }, pkg: { kind: "package", packageName: "@acme/docs", resolveFrom: "." } } }] };
    const normalized = normalizeConfig(input, file); assert.equal(normalized.providers[0]!.authority.rootDir, path.join(root, "provider"));
    assert.equal(normalized.providers[0]!.enabled, true); assert.equal(configPath(file), file);
    for (const value of [{}, { schemaVersion: 2, providers: [] }, { schemaVersion: 1, providers: [], unknown: true },
      { schemaVersion: 1, providers: [], budgets: { runtime: {} } }, { ...input, providers: [input.providers[0], input.providers[0]] },
      { schemaVersion: 1, providers: [], httpReader: { allowedOrigins: ["https://example.test/path"] } },
      { schemaVersion: 1, providers: [], http: { limits: { maxClients: 0 } } },
      { schemaVersion: 1, providers: [], http: { limits: { requestTimeoutMs: 2_147_483_648 } } },
      { schemaVersion: 1, providers: [], httpReader: { allowedOrigins: ["https://example.test"], timeoutMs: 2_147_483_648 } }])
      assert.throws(() => normalizeConfig(value, file), { exitCode: 2 });
    await saveConfig(file, { schemaVersion: 1, providers: [] }, null);
    const startup = await openConfigured(file); const firstDigest = startup.configDigest;
    try { assert.deepEqual(startup.graph.getProviderScope(), []);
      await writeFile(file, JSON.stringify({ schemaVersion: 1, providers: [], http: { port: 7777 } }));
      assert.equal(startup.configDigest, firstDigest); assert.notEqual((await loadConfig(file)).configDigest, firstDigest);
    } finally { await startup.close(); }
    await writeFile(file, "x".repeat(1_048_577)); await assert.rejects(loadConfig(file), /超过/);
  } finally { await removeTestDirectory(root); }
});

test("configuration byte CAS rejects concurrent edits without replacing them", async () => {
  const root = await createTestDirectory("cli-config-cas-"); const file = path.join(root, "config.json");
  try {
    await saveConfig(file, { schemaVersion: 1, providers: [] }, null); const old = await loadConfig(file);
    const external = JSON.stringify({ schemaVersion: 1, providers: [], http: { port: 4444 } }); await writeFile(file, external);
    await assert.rejects(saveConfig(file, old.config, old.originalDigest), { exitCode: 3 });
    assert.equal((await loadConfig(file)).config.http!.port, 4444);
  } finally { await removeTestDirectory(root); }
});
