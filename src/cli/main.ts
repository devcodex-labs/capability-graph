#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { CapabilityGraph } from "../capability-graph.js";
import { CapabilityGraphError } from "../errors.js";
import { createCapabilityGraphServer } from "../mcp/server.js";
import { CliError, configPath, loadConfig, normalizeConfig, saveConfig, openConfigured } from "./config.js";
import { registerCodex, unregisterCodex } from "./codex-registration.js";
import { diagnose, diagnosticFailed } from "./doctor.js";
import { canonicalJson } from "../hash.js";

const help = `Capability Graph 2.0.0
用法：capability-graph <命令> [参数]

  serve [--transport stdio|http] [--config 文件] [--host 地址 --port 端口]
    默认stdio；HTTP默认127.0.0.1:3333/mcp。stdio stdout只输出协议，启动信息在stderr。
  provider add --id ID --root 目录 [--layout directory|legacy] [--config 文件]
    layout默认directory；root相对配置文件目录解析，验证来源后保存，下次服务启动生效。
  provider list [--config 文件]
  provider remove --id ID [--config 文件]
    只移除配置中的Provider，保留源资料。未登记ID重复移除成功。
  codex register [--config 文件] [--codex-home 目录]
    默认Codex目录为CODEX_HOME或~/.codex；仅更新未被用户修改的owned条目。
  codex unregister [--config 文件] [--codex-home 目录]
    先运行此命令，再npm uninstall -g @devcodex/capability-graph。
  codex status [--config 文件] [--codex-home 目录] [--json]
    重新检查当前文件，保留四个独立状态；不启动进程，不联网。
  doctor [--config 文件] [--codex-home 目录] [--json] [--http-url URL] [--network]
    默认运行一个最多10000毫秒的临时stdio探针并关闭；HTTP只访问显式URL。
    --network只对配置的允许来源做有限HEAD，默认不访问Provider网络。
  assist
    仅TTY交互，选择以上命令；取消前不保存。
  --help（所有子命令均支持）

配置默认~/.capability-graph/config.json，不搜索cwd。JSON最多1MiB，最小配置：
  {"schemaVersion":1,"providers":[]}
例子：
  capability-graph provider add --id seed.http --root D:/providers/seed --layout directory
  capability-graph codex register
  capability-graph doctor --json
  capability-graph serve --transport http --config D:/cg/config.json
非回环HTTP还需显式token、allowedOrigins、allowedHostnames与allowedProviders。
退出码：0成功；1内部/清理失败；2用法/配置；3注册/文件冲突；4诊断失败；130取消。
`;
const optionTypes = { help: { type: "boolean" }, json: { type: "boolean" }, network: { type: "boolean" },
  config: { type: "string" }, transport: { type: "string" }, host: { type: "string" }, port: { type: "string" },
  id: { type: "string" }, root: { type: "string" }, layout: { type: "string" }, "codex-home": { type: "string" }, "http-url": { type: "string" } } as const;
const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
async function assist(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write("assist需要TTY。使用 capability-graph --help，或直接运行 provider add / codex register / doctor。\n"); return 2; }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const cancelled = new AbortController(); const interrupt = () => cancelled.abort(); process.once("SIGINT", interrupt);
  input.once("SIGINT", interrupt);
  try {
    const choice = (await input.question("1 添加Provider  2 查看Provider  3 注册Codex  4 doctor  0 取消\n选择：", { signal: cancelled.signal })).trim();
    if (choice === "0" || !choice) return 130;
    if (choice === "1") {
      const id = await input.question("Provider ID（需与provider.json一致）：", { signal: cancelled.signal });
      const root = await input.question("来源绝对目录：", { signal: cancelled.signal });
      const confirm = await input.question(`保存Provider ${id}，来源 ${root}？输入yes继续：`, { signal: cancelled.signal });
      if (confirm !== "yes") return 130;
      return main(["provider", "add", "--id", id, "--root", root]);
    }
    if (choice === "2") return main(["provider", "list"]);
    if (choice === "3") {
      const confirm = await input.question("注册此服务到当前Codex配置？输入yes继续：", { signal: cancelled.signal });
      return confirm === "yes" ? main(["codex", "register"]) : 130;
    }
    if (choice === "4") return main(["doctor"]);
    throw new CliError("无效选择。");
  } catch (error) { if (cancelled.signal.aborted) return 130; throw error; }
  finally { process.removeListener("SIGINT", interrupt); input.close(); }
}

/** CLI entry owns resources only for serve/doctor. Importing public SDK entries never executes this module. */
async function main(argv: string[]): Promise<number> {
  const parse = () => {
    try { return parseArgs({ args: argv, options: optionTypes, allowPositionals: true, strict: true }); }
    catch { throw new CliError("参数无效，运行 capability-graph --help。"); }
  };
  const parsed = parse();
  const { values, positionals } = parsed; const [command, action] = positionals;
  if (values.help || !command) { process.stdout.write(help); return 0; }
  const allowed: Record<string, string[]> = { serve: ["config", "transport", "host", "port"], provider: ["config", "id", "root", "layout"],
    codex: ["config", "codex-home", "json"], doctor: ["config", "codex-home", "json", "http-url", "network"], assist: [] };
  if (!allowed[command] || Object.keys(values).some(key => !allowed[command]!.includes(key))) throw new CliError("命令或参数不匹配，运行 capability-graph --help。");
  const file = configPath(values.config);
  if (command === "assist") { if (positionals.length !== 1) throw new CliError("assist不接受位置参数。"); return assist(); }
  if (command === "provider") {
    if (positionals.length !== 2 || !["add", "list", "remove"].includes(action ?? "")) throw new CliError("使用 provider add/list/remove。");
    if (action !== "add" && (values.root || values.layout)) throw new CliError("root/layout仅用于provider add。");
    const loaded = await loadConfig(file, action === "add");
    if (action === "list") { if (values.id) throw new CliError("provider list不接受id。"); print({ configPath: file, providers: loaded.config.providers, effective: "下次服务启动" }); return 0; }
    if (!values.id) throw new CliError("需要--id。");
    if (action === "remove") {
      const providers = loaded.config.providers.filter(provider => provider.providerId !== values.id);
      if (providers.length !== loaded.config.providers.length) await saveConfig(file, { ...loaded.config, providers }, loaded.originalDigest);
      print({ removed: values.id, configPath: file, effective: "下次服务启动", sourceFilesPreserved: true }); return 0;
    }
    if (!values.root || (values.layout && !["directory", "legacy"].includes(values.layout))) throw new CliError("provider add需要--root，layout为directory或legacy。");
    const candidate = normalizeConfig({ schemaVersion: 1, providers: [{ providerId: values.id,
      authority: { kind: "file", rootDir: values.root, definitionLayout: values.layout ?? "directory" } }] }, file).providers[0]!;
    const existing = loaded.config.providers.find(provider => provider.providerId === values.id);
    if (existing) {
      if (canonicalJson(existing.authority) !== canonicalJson(candidate.authority)) throw new CliError("同ID已登记不同来源，先检查现有配置。", 3);
      print({ provider: existing, idempotent: true, configPath: file }); return 0;
    }
    const graph = await CapabilityGraph.open({ hostAllowedProviders: [values.id], integrationEnabledProviders: [values.id], providers: [candidate] });
    await graph.close(); await saveConfig(file, { ...loaded.config, providers: [...loaded.config.providers, candidate] }, loaded.originalDigest);
    print({ provider: candidate, configPath: file, effective: "下次服务启动" }); return 0;
  }
  if (command === "codex") {
    if (positionals.length !== 2 || !["register", "unregister", "status"].includes(action ?? "")) throw new CliError("使用 codex register/unregister/status。");
    if (action === "register") {
      const loaded = await loadConfig(file, true); if (loaded.originalDigest === null) await saveConfig(file, loaded.config, null);
      print(await registerCodex(file, values["codex-home"])); return 0;
    }
    if (action === "unregister") { print(await unregisterCodex(file, values["codex-home"])); return 0; }
    const result = await diagnose(file, { codexHome: values["codex-home"] }); print(result); return diagnosticFailed(result) ? 4 : 0;
  }
  if (command === "doctor") {
    if (positionals.length !== 1) throw new CliError("doctor不接受位置参数。");
    const result = await diagnose(file, { probe: true, codexHome: values["codex-home"], httpUrl: values["http-url"], network: values.network });
    print(result); return diagnosticFailed(result) ? 4 : 0;
  }
  if (positionals.length !== 1) throw new CliError("serve不接受额外位置参数。");
  const transport = values.transport ?? "stdio";
  if (!["stdio", "http"].includes(transport) || (transport === "stdio" && (values.host || values.port))) throw new CliError("transport为stdio/http；host/port仅用于HTTP。");
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!/^[0-9]+$/.test(values.port!) || !Number.isInteger(port) || port < 1 || port > 65535)) throw new CliError("port必须为1~65535。");
  const configured = await openConfigured(file);
  const server = await (async () => {
    try { return createCapabilityGraphServer({ graph: configured.graph, transport: transport as "stdio" | "http",
      http: { ...configured.config.http, ...(values.host ? { host: values.host } : {}), ...(port === undefined ? {} : { port }) } }); }
    catch (error) { await configured.close(); throw new CliError(error instanceof Error ? error.message : "服务配置无效"); }
  })();
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  let stopping: Promise<void> | undefined, result = 0;
  const stop = (cancelled = false) => stopping ??= (async () => {
    result = cancelled ? 130 : 0;
    try { await server.close(); } finally { await configured.close(); }
  })().catch(error => { result = 1; process.stderr.write(`清理失败：${error instanceof Error ? error.message : String(error)}\n`); }).finally(finish);
  const interrupt = () => { void stop(true); }, terminate = () => { void stop(); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", terminate);
  if (transport === "stdio") process.stdin.once("end", terminate);
  try {
    const address = await server.start(); process.stderr.write(JSON.stringify({ event: "started", ...address, configPath: file, configDigest: configured.configDigest }) + "\n");
    await done; return result;
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", terminate); process.stdin.removeListener("end", terminate);
    await stop();
  }
}

try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = error instanceof CliError ? error.exitCode : error instanceof CapabilityGraphError &&
    ["CG_CONFIG_INCOMPLETE", "CG_VALIDATION_FAILED", "CG_LOAD_FAILED", "CG_SCOPE_DENIED", "CG_IDENTITY_INVALID"].includes(error.code) ? 2 : 1;
}
