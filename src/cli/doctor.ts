import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { resolveBudgets } from "../budgets.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadConfig, openConfigured } from "./config.js";
import { registrationStatus, type DiagnosticState } from "./codex-registration.js";

export interface DoctorOptions { readonly probe?: boolean; readonly httpUrl?: string; readonly network?: boolean; readonly codexHome?: string }
export interface DoctorResult {
  readonly installed: DiagnosticState; readonly configRegistered: DiagnosticState;
  readonly localProtocolVerified: DiagnosticState; readonly clientConnected: DiagnosticState;
  readonly configPath: string; readonly configDigest?: string; readonly packageVersion: string;
  readonly entryOwnership: string; readonly checkedAt: string; readonly diagnosticScope: string;
  readonly checks: readonly { name: string; state: string; reason?: string }[];
}
/** Spawn only the installed CLI, verify a real twelve-tool exchange, and always await owned process cleanup. */
export async function localProtocolProbe(file: string): Promise<DiagnosticState> {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("./main.js", import.meta.url)), "serve", "--transport", "stdio", "--config", file],
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), stderr: "pipe" });
  const client = new Client({ name: "capability-graph-doctor", version: "2.0.0" });
  let stderr = "", expired = false, timedCleanup: Promise<void> | undefined;
  transport.stderr?.on("data", chunk => { if (stderr.length < 65536) stderr += String(chunk).slice(0, 65536 - stderr.length); });
  const timer = setTimeout(() => { expired = true; timedCleanup = transport.close(); }, 10_000);
  try {
    await client.connect(transport); const list = await client.listTools();
    if (list.tools.length !== 12 || !list.tools.some(tool => tool.name === "capability_graph_read_specification_page")) throw new Error("Expected the twelve-tool query surface");
    return { state: "pass", evidence: `临时stdio进程PID=${transport.pid}，tools/list=12；探针退出后不代表Codex客户端已连接` };
  } catch {
    return { state: "fail", reason: expired ? "本地协议探针超过10000毫秒" : stderr.trim() || "本地stdio协议交换失败", nextAction: "capability-graph doctor --json" };
  } finally { clearTimeout(timer); await client.close(); await timedCleanup; }
}
async function httpProbe(url: string, token?: string): Promise<DiagnosticState> {
  const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("HTTP URL无效");
  const response = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "doctor", version: "2.0.0" }, "io.modelcontextprotocol/clientCapabilities": {},
  } } }) });
  const text = await response.text();
  return response.ok && text.includes("capability_graph_read_specification_page") ? { state: "pass", evidence: url } :
    { state: "fail", reason: `指定HTTP端点返回${response.status}或未提供预期工具`, nextAction: "检查端点、token与服务配置" };
}

/** Four independent current states. status skips process/network probes; doctor makes only explicitly requested remote requests. */
export async function diagnose(file: string, options: DoctorOptions = {}): Promise<DoctorResult> {
  let installed: DiagnosticState;
  try { await access(fileURLToPath(new URL("./main.js", import.meta.url))); installed = { state: "pass", evidence: fileURLToPath(new URL("./main.js", import.meta.url)) }; }
  catch { installed = { state: "fail", reason: "CLI文件缺失", nextAction: "重新安装此包" }; }
  const registered = await registrationStatus(file, options.codexHome);
  const checks: { name: string; state: string; reason?: string }[] = [];
  let configDigest: string | undefined;
  let localProtocolVerified: DiagnosticState = { state: "not_run", reason: "status不启动进程" };
  let configured: Awaited<ReturnType<typeof openConfigured>> | undefined;
  try {
    const loaded = await loadConfig(file); configDigest = loaded.configDigest;
    if (options.probe) configured = await openConfigured(file);
    checks.push({ name: options.probe ? "configuration-and-local-sources" : "configuration", state: "pass" });
    if (options.probe) localProtocolVerified = options.httpUrl ? await httpProbe(options.httpUrl, loaded.config.http?.bearerToken) : await localProtocolProbe(file);
    if (options.network && configured) {
      const urls = new Set<string>(); const allowed = new Set(loaded.config.httpReader?.allowedOrigins ?? []);
      for (const provider of (await configured.graph.listProviders()).items.slice(0, 32)) {
        for (const ref of (await configured.graph.listSpecificationDocuments({ providerId: provider.providerId, limit: 32 })).items)
          if (ref.locator.type === "http" && allowed.has(new URL(ref.locator.url).origin)) urls.add(ref.locator.url);
      }
      const budgets = resolveBudgets(loaded.config.budgets);
      const catalog = await configured.graph.listCatalog({ limit: Math.min(20, budgets.catalog.maxItems, budgets.detail.maxCapabilities) });
      const details = catalog.items.length ? await configured.graph.getCapabilities(catalog.items.map(item => ({ providerId: item.providerId, capabilityId: item.id.capabilityId }))) : undefined;
      for (const item of details?.results ?? []) if (item.ok) for (const ref of item.value.knowledge.items)
        if (ref.kind === "document" && ref.locator.type === "http" && allowed.has(new URL(ref.locator.url).origin)) urls.add(ref.locator.url);
      for (const url of [...urls].slice(0, 32)) {
        try { const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(2000) });
          await response.body?.cancel(); checks.push({ name: `HEAD ${url}`, state: response.ok || response.status === 304 ? "pass" : "fail", reason: `HTTP ${response.status}` });
        } catch { checks.push({ name: `HEAD ${url}`, state: "fail", reason: "超时或连接失败" }); }
      }
      checks.push({ name: "network-scope", state: urls.size ? "pass" : "not_run", reason: urls.size ? "仅httpReader允许Origin内、首批元数据最多32个URL，HEAD无正文；不是全量远程可用性保证" : "本次元数据样本没有获准的HTTP URL，未发起网络请求" });
    } else checks.push({ name: "network", state: "not_run", reason: "未显式使用--network" });
  } catch (error) {
    checks.push({ name: "configuration-or-probe", state: "fail", reason: error instanceof Error ? error.message : "检查失败" });
    if (options.probe) localProtocolVerified = { state: "fail", reason: "配置、来源或协议探针失败", nextAction: "检查checks中的失败项" };
  } finally { await configured?.close(); }
  return { installed, configRegistered: registered, localProtocolVerified, clientConnected: { state: "unknown", reason: "本命令没有Codex客户端的实时连接证据" },
    configPath: file, ...(configDigest ? { configDigest } : {}), packageVersion: "2.0.0", entryOwnership: registered.entryOwnership,
    checkedAt: new Date().toISOString(), diagnosticScope: options.httpUrl ? "explicit-http-endpoint-and-selected-config" : options.probe ? "owned-local-probe-configuration" : "current-files-only", checks };
}
export const diagnosticFailed = (result: DoctorResult) => [result.installed, result.configRegistered, result.localProtocolVerified].some(value => value.state === "fail") || result.checks.some(check => check.state === "fail");
