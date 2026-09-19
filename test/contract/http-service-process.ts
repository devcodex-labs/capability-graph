import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { ServiceConfig } from "../../examples/seed-runtime/service.js";

export async function assertPortReleased(port: number) {
  const probe = createServer();
  try { await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); }); }
  finally { if (probe.listening) await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve())); }
}
export async function launchService(config: ServiceConfig, context: TestContext) {
  const entry = fileURLToPath(new URL("../../examples/seed-runtime/main.js", import.meta.url));
  const cwd = fileURLToPath(new URL("../../../", import.meta.url));
  const child = fork(entry, [JSON.stringify(config)], { cwd, silent: true });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let stderr = ""; child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  child.stdout?.resume();
  let ready: { url: string; port: number; pid: number };
  try {
    ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Service startup timeout")), 5000);
      child.once("error", reject);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Service exited before ready: ${stderr}`)); });
      child.once("message", (message: unknown) => {
        clearTimeout(timer);
        const value = message as typeof ready & { ready?: boolean };
        if (value.ready && value.pid === child.pid && Number.isInteger(value.port)) resolve(value); else reject(new Error("Invalid ready message"));
      });
    });
  } catch (error) { if (child.pid && child.exitCode === null) { child.kill(); await exited; } throw error; }
  context.diagnostic(`start PID=${ready.pid} cwd=${cwd} command=node ${entry} project=${config.project} environment=${config.environment} URL=${ready.url}`);
  let id = 0; let stopped = false;
  return { ...ready,
    async register(method: string, path: string) {
      const requestId = ++id;
      await new Promise<void>((resolve, reject) => {
        const handler = (raw: unknown) => {
          const value = raw as { id?: number; ok?: boolean };
          if (value.id !== requestId) return;
          clearTimeout(timer); child.removeListener("message", handler);
          if (value.ok) resolve(); else reject(new Error("Registration failed"));
        };
        const timer = setTimeout(() => { child.removeListener("message", handler); reject(new Error("Registration timeout")); }, 3000);
        child.on("message", handler); child.send({ action: "register", id: requestId, method, path });
      });
    },
    async stop() {
      if (stopped) return; stopped = true;
      const timer = setTimeout(() => child.kill(), 3000);
      try { if (child.connected) child.send({ action: "close" }); await exited; } finally { clearTimeout(timer); }
      assert.throws(() => process.kill(ready.pid, 0)); await assertPortReleased(ready.port);
      context.diagnostic(`cleanup PID=${ready.pid} absent; port=${ready.port} released`);
    },
  };
}
