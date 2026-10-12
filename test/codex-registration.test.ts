import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { registerCodex, unregisterCodex, registrationStatus, installedEntry, findCodex } from "../src/cli/codex-registration.js";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

async function fixture(run: (root: string, file: string, home: string) => Promise<void>, cli = false) {
  const root = await createTestDirectory("codex-registration-"); const file = path.join(root, "配置 空格.json"), home = path.join(root, "隔离 Codex");
  const originalPath = process.env.PATH; if (!cli) process.env.PATH = "";
  try { await mkdir(home); await writeFile(file, '{"schemaVersion":1,"providers":[]}'); await run(root, file, home); }
  finally { process.env.PATH = originalPath; await removeTestDirectory(root); }
}

test("owned registration preserves comments/CRLF/Unicode and unregister removes only its byte region", async () => fixture(async (_root, file, home) => {
  const target = path.join(home, "config.toml");
  for (const original of ['# 中文\r\nmodel = "test"\r\n[mcp_servers.other]\r\ncommand = "other" # keep\r\n', 'model = "test"', '\ufeff# 原样BOM\r\nmodel = "test"\r\n']) {
    await writeFile(target, original); const first = await registerCodex(file, home); assert.equal(first.generatedBy, "cli-absent-generator");
    const registered = await readFile(target, "utf8"); assert(registered.startsWith(original));
    assert.equal((await registrationStatus(file, home)).state, "pass");
    await registerCodex(file, home); assert.equal(await readFile(target, "utf8"), registered);
    await unregisterCodex(file, home); assert.equal(await readFile(target, "utf8"), original);
    await unregisterCodex(file, home); assert.equal(await readFile(target, "utf8"), original);
    assert.equal((await registrationStatus(file, home)).state, "fail");
    assert.equal(JSON.parse(await readFile(file, "utf8")).providers.length, 0);
  }
}));

test("external identical/inline/dotted/quoted names and malformed TOML cannot be silently adopted", async () => fixture(async (_root, file, home) => {
  const target = path.join(home, "config.toml"), entry = installedEntry(file);
  const cases = [
    `[mcp_servers.capability_graph]\ncommand=${JSON.stringify(entry.command)}\nargs=${JSON.stringify(entry.args)}\n`,
    'mcp_servers = { capability_graph = { command = "external" } }\n',
    'mcp_servers.capability_graph.command = "external"\n',
    '[mcp_servers."capability_graph"]\ncommand="external"\n',
    '[mcp_servers.capability_graph]\ncommand="a"\ncommand="b"\n', '[broken',
  ];
  for (const original of cases) {
    await writeFile(target, original); await assert.rejects(registerCodex(file, home), { exitCode: 3 });
    await assert.rejects(unregisterCodex(file, home), { exitCode: 3 }); assert.equal(await readFile(target, "utf8"), original);
  }
}));

test("user edits to an owned entry are preserved and fail both upgrade and unregister", async () => fixture(async (_root, file, home) => {
  const target = path.join(home, "config.toml"); await registerCodex(file, home);
  const registered = await readFile(target, "utf8"), changed = registered.replace('command = ', '# user note\ncommand = '); await writeFile(target, changed);
  await assert.rejects(registerCodex(file, home), { exitCode: 3 }); await assert.rejects(unregisterCodex(file, home), { exitCode: 3 });
  assert.equal(await readFile(target, "utf8"), changed); assert.equal((await registrationStatus(file, home)).state, "fail");
}));

test("prepared journal commits after a successful config write without rolling back unrelated edits", async () => fixture(async (root, file, home) => {
  const target = path.join(home, "config.toml"); await writeFile(target, '# keep\n'); await registerCodex(file, home);
  const journalFile = path.join(root, (await readdir(root)).find(name => name.startsWith('registration-journal-'))!);
  const journal = JSON.parse(await readFile(journalFile, 'utf8')); journal.state = 'prepared'; await writeFile(journalFile, JSON.stringify(journal));
  assert.equal((await registrationStatus(file, home)).entryOwnership, 'recovery-required');
  await writeFile(path.join(root, 'registration.json'), JSON.stringify({ schemaVersion: 1, entries: {} }));
  const current = await readFile(target, 'utf8'); await writeFile(target, '# external after crash\n' + current);
  await registerCodex(file, home); assert((await readFile(target, 'utf8')).startsWith('# external after crash\n# keep\n'));
  assert.equal(JSON.parse(await readFile(journalFile, 'utf8')).state, 'committed');
}));

test("two cooperating registration writers serialize and preserve a single owned entry", async () => fixture(async (_root, file, home) => {
  await Promise.all([registerCodex(file, home), registerCodex(file, home)]);
  const text = await readFile(path.join(home, 'config.toml'), 'utf8'); assert.equal(text.split('[mcp_servers.capability_graph]').length - 1, 1);
  assert.equal((await registrationStatus(file, home)).state, 'pass');
}));

test("installed official Codex CLI generates command/argv in a disposable CODEX_HOME", async context => {
  if (!await findCodex()) { context.skip('official Codex CLI is absent; fallback generation is verified separately'); return; }
  await fixture(async (_root, file, home) => {
  const result = await registerCodex(file, home); assert.equal(result.generatedBy, 'official-cli'); assert.equal((await registrationStatus(file, home)).state, 'pass');
  await unregisterCodex(file, home);
  }, true);
});
