import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createTestDirectory, removeTestDirectory } from "./contract/temporary-directory.js";

const entry = path.resolve("dist/cli/main.js");
function run(args: string[], home: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, [entry, ...args], { windowsHide: true, timeout: 20_000, maxBuffer: 1_048_576,
      env: { ...process.env, CODEX_HOME: home } }, (error, stdout, stderr) => {
      resolve({ code: error ? typeof error.code === "number" ? error.code : 1 : 0, stdout, stderr });
    });
  });
}
test("CLI help needs no configuration; invalid flags and non-TTY assist have actionable exits", async () => {
  const root = await createTestDirectory("cli-help-");
  try {
    for (const args of [["--help"], ["provider", "add", "--help"], ["codex", "register", "--help"]]) {
      const result = await run([...args, "--config", path.join(root, "missing.json")], root);
      assert.equal(result.code, 0); assert.match(result.stdout, /schemaVersion/); assert.equal(result.stderr, "");
    }
    for (const args of [["--unknown"], ["serve", "--transport", "other"], ["assist"]]) {
      const result = await run(args, root); assert.equal(result.code, 2); assert.match(result.stderr, /help|TTY|transport/);
    }
  } finally { await removeTestDirectory(root); }
});

test("Provider CLI validates before saving, is idempotent and removes registration without source deletion", async () => {
  const root = await createTestDirectory("cli-provider-"); const config = path.join(root, "配置.json");
  const source = path.resolve("examples/seed-provider"), before = await readFile(path.join(source, "provider.json"), "utf8");
  try {
    const add = ["provider", "add", "--id", "seed.http", "--root", source, "--layout", "directory", "--config", config];
    assert.equal((await run(add, root)).code, 0); const registered = await readFile(config, "utf8");
    assert.equal((await run(add, root)).code, 0); assert.equal(await readFile(config, "utf8"), registered);
    const list = await run(["provider", "list", "--config", config], root); assert.equal(JSON.parse(list.stdout).providers.length, 1);
    const bad = await run(["provider", "add", "--id", "wrong", "--root", source, "--config", config], root);
    assert.equal(bad.code, 2); assert.equal(await readFile(config, "utf8"), registered);
    const conflict = await run(["provider", "add", "--id", "seed.http", "--root", root, "--config", config], root);
    assert.equal(conflict.code, 3); assert.equal(await readFile(config, "utf8"), registered);
    assert.equal((await run(["provider", "remove", "--id", "seed.http", "--config", config], root)).code, 0);
    assert.equal((await run(["provider", "remove", "--id", "seed.http", "--config", config], root)).code, 0);
    assert.equal(await readFile(path.join(source, "provider.json"), "utf8"), before);
  } finally { await removeTestDirectory(root); }
});

test("Codex status is current-file-only; doctor owns a real short-lived protocol process and keeps connection unknown", async () => {
  const root = await createTestDirectory("cli-doctor-"); const config = path.join(root, "config.json");
  try {
    await writeFile(config, '{"schemaVersion":1,"providers":[]}');
    assert.equal((await run(["codex", "register", "--config", config], root)).code, 0);
    const status = await run(["codex", "status", "--config", config, "--json"], root), current = JSON.parse(status.stdout);
    assert.equal(status.code, 0); assert.equal(current.configRegistered.state, "pass"); assert.equal(current.localProtocolVerified.state, "not_run"); assert.equal(current.clientConnected.state, "unknown");
    const result = await run(["doctor", "--config", config, "--json"], root), doctor = JSON.parse(result.stdout);
    assert.equal(result.code, 0, result.stderr + result.stdout); assert.equal(doctor.localProtocolVerified.state, "pass"); assert.equal(doctor.clientConnected.state, "unknown");
    const pid = Number(doctor.localProtocolVerified.evidence.match(/PID=(\d+)/)[1]);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const target = path.join(root, "config.toml"); await writeFile(target, (await readFile(target, "utf8")).replace("command = ", "# user changed\ncommand = "));
    const drift = await run(["codex", "status", "--config", config, "--json"], root); assert.equal(drift.code, 4); assert.equal(JSON.parse(drift.stdout).configRegistered.state, "fail");
    assert.equal((await run(["codex", "unregister", "--config", config], root)).code, 3);
  } finally { await removeTestDirectory(root); }
});
