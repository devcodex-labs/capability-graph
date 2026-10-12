import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { CliError, digest, readText, replaceText, withFileLock } from "./config.js";
import { canonicalJson } from "../hash.js";

const exec = promisify(execFile);
// The fixed parser's optional ESLint declaration surface is not part of this CLI's runtime or public contract.
const { parseTOML, getStaticTOMLValue } = createRequire(import.meta.url)("toml-eslint-parser") as {
  parseTOML(text: string, options: { tomlVersion: "1.0.0" }): unknown;
  getStaticTOMLValue(ast: unknown): unknown;
};
const serverId = "capability_graph";
type Entry = { command: string; args: string[] };
type Receipt = { target: string; ownerId: string; entryDigest: string; blockDigest: string; packageVersion: string; entry: Entry; leadingNewline?: string };
type Receipts = { schemaVersion: 1; entries: Record<string, Receipt> };
type Journal = { schemaVersion: 1; state: "prepared" | "committed" | "rolled_back" | "recovery_required";
  target: string; operation: "register" | "unregister"; beforeEntryDigest: string | null; after: Receipt | null; before: Receipt | null; operationId: string };
export type DiagnosticState = { state: "pass" | "fail" | "unknown" | "not_run"; evidence?: string; reason?: string; nextAction?: string };
export const codexHome = (explicit?: string) => path.resolve(explicit ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
const json = <T>(text: string | undefined, fallback: T): T => {
  if (text === undefined) return fallback;
  try { return JSON.parse(text.replace(/^\uFEFF/, "")) as T; } catch { throw new CliError("注册记录JSON损坏，需要检查registration.json。", 3); }
};
function parsed(text: string) {
  try {
    const ast = parseTOML(text.replace(/^\uFEFF/, ""), { tomlVersion: "1.0.0" });
    const value = getStaticTOMLValue(ast) as { mcp_servers?: Record<string, unknown> };
    const entry = value.mcp_servers?.[serverId];
    return { ast, entry, entryDigest: entry === undefined ? null : digest(canonicalJson(entry)) };
  } catch { throw new CliError("Codex config.toml语法无效（包括重复键或表），未修改文件。", 3); }
}
function markers(ownerId: string) { return [`# capability-graph owned ${ownerId}`, `# capability-graph end ${ownerId}`] as const; }
function block(text: string, receipt: Receipt): { start: number; end: number; text: string } {
  const [begin, finish] = markers(receipt.ownerId); const markerStart = text.indexOf(begin), last = text.indexOf(finish);
  if (markerStart < 0 || last <= markerStart || text.indexOf(begin, markerStart + 1) !== -1 || text.indexOf(finish, last + 1) !== -1) throw new CliError("owned注册区域已被改写，不能自动覆盖或删除。", 3);
  const start = markerStart - (receipt.leadingNewline?.length ?? 0);
  if (start < 0 || (receipt.leadingNewline && text.slice(start, markerStart) !== receipt.leadingNewline)) throw new CliError("owned分隔符已改变，保留配置。", 3);
  const newline = text.indexOf("\n", last); const end = newline === -1 ? text.length : newline + 1;
  const owned = text.slice(start, end);
  if (digest(owned) !== receipt.blockDigest || parsed(text).entryDigest !== receipt.entryDigest || parsed(owned).entryDigest !== receipt.entryDigest)
    throw new CliError("注册条目或owned区域已被修改，保留用户内容。", 3);
  return { start, end, text: owned };
}
const generatedBlock = (entry: Entry, ownerId: string, newline: string) => {
  const [begin, end] = markers(ownerId);
  return [begin, `[mcp_servers.${serverId}]`, `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map(argument => JSON.stringify(argument)).join(", ")}]`, end, ""].join(newline);
};
export function installedEntry(file: string, cliFile = fileURLToPath(new URL("./main.js", import.meta.url))): Entry {
  return { command: process.execPath, args: [path.resolve(cliFile), "serve", "--transport", "stdio", "--config", path.resolve(file)] };
}
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
/** Prefer direct executable or the official Node entry behind an npm shim. User argv is never interpolated into cmd.exe. */
/** Locate a directly executable installed CLI without invoking a shell shim. */
export async function findCodex(): Promise<{ command: string; args: string[] } | undefined> {
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  for (const directory of directories) { const command = path.join(directory, name); if (await exists(command)) return { command, args: [] }; }
  if (process.platform === "win32") for (const directory of directories) {
    const shim = path.join(directory, "codex.cmd");
    if (await exists(shim)) {
      const nodeEntry = path.join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
      const body = await readText(shim, 65536);
      if (body?.replaceAll("\\", "/").includes("node_modules/@openai/codex/bin/codex.js") && await exists(nodeEntry)) return { command: process.execPath, args: [nodeEntry] };
      throw new CliError("检测到codex.cmd但无法定位可直接执行的官方Node入口。请将codex.exe加入PATH后重试。", 3);
    }
  }
}
/** CLI writes only to a disposable CODEX_HOME; its output is validated before any user target merge. */
async function validateWithCodex(entry: Entry): Promise<"official-cli" | "cli-absent-generator"> {
  const cli = await findCodex(); if (!cli) return "cli-absent-generator";
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cg-codex-registration-")); const identity = await realpath(temporary);
  try {
    try { await exec(cli.command, [...cli.args, "mcp", "add", serverId, "--", entry.command, ...entry.args], {
      cwd: temporary, env: { ...process.env, CODEX_HOME: temporary }, windowsHide: true, timeout: 10_000, maxBuffer: 65536,
    }); } catch { throw new CliError("Codex CLI生成注册条目失败，未修改目标配置。运行codex mcp add --help检查CLI版本。", 3); }
    const text = await readText(path.join(temporary, "config.toml"));
    if (!text || parsed(text).entryDigest !== digest(canonicalJson(entry))) throw new CliError("Codex CLI生成的条目与目标command/args不一致。", 3);
    return "official-cli";
  } finally {
    if (await realpath(temporary) !== identity || !path.basename(identity).startsWith("cg-codex-registration-")) throw new CliError("临时注册目录身份变化，停止清理。", 1);
    await rm(identity, { recursive: true, force: true });
  }
}
async function writeJson(file: string, value: unknown) {
  const before = await readText(file); await replaceText(file, JSON.stringify(value, null, 2) + "\n", before === undefined ? null : digest(before));
}
function paths(config: string, home?: string) {
  const target = path.join(codexHome(home), "config.toml"), key = digest(target);
  const receipt = path.join(path.dirname(path.resolve(config)), "registration.json");
  return { target, key, receipt, journal: path.join(path.dirname(receipt), `registration-journal-${key.slice(0, 16)}.json`) };
}
function receipts(text?: string): Receipts {
  const result = json<Receipts>(text, { schemaVersion: 1, entries: {} });
  if (result.schemaVersion !== 1 || !result.entries || typeof result.entries !== "object" || Array.isArray(result.entries)) throw new CliError("ownership记录格式无效。", 3);
  return result;
}

async function recover(target: string, key: string, receiptFile: string, journalFile: string, ledger: Receipts): Promise<void> {
  const journal = json<Journal | undefined>(await readText(journalFile), undefined);
  if (journal?.state === "recovery_required") throw new CliError("注册事务需要人工恢复，未修改配置。请检查registration-journal记录。", 3);
  if (!journal || journal.state !== "prepared") return;
  if (journal.target !== target || journal.schemaVersion !== 1) throw new CliError("注册恢复目标不匹配。", 3);
  const text = await readText(target) ?? "", current = parsed(text);
  if (journal.after ? current.entryDigest === journal.after.entryDigest : current.entryDigest === null) {
    if (journal.after) { block(text, journal.after); ledger.entries[key] = journal.after; } else delete ledger.entries[key];
    await writeJson(receiptFile, ledger); await writeJson(journalFile, { ...journal, state: "committed" }); return;
  }
  if (current.entryDigest === journal.beforeEntryDigest) {
    if (journal.before) block(text, journal.before);
    await writeJson(journalFile, { ...journal, state: "rolled_back" }); return;
  }
  await writeJson(journalFile, { ...journal, state: "recovery_required" });
  throw new CliError("中断注册事务遇到用户改写，需要人工检查；未回滚整个配置。", 3);
}

/** Register/update only an unchanged owned entry. An identical external entry remains a conflict. */
export async function registerCodex(config: string, home?: string, cliFile?: string) {
  const location = paths(config, home), entry = installedEntry(config, cliFile);
  const generatedBy = await validateWithCodex(entry);
  return withFileLock(location.receipt, () => withFileLock(location.target, async () => {
    const ledger = receipts(await readText(location.receipt));
    await recover(location.target, location.key, location.receipt, location.journal, ledger);
    const originalRead = await readText(location.target), original = originalRead ?? "", current = parsed(original), previous = ledger.entries[location.key];
    if (current.entry !== undefined && !previous) throw new CliError("存在外部同名capability_graph条目，不能自动认领。", 3);
    if (previous && previous.target !== location.target) throw new CliError("ownership目标不匹配。", 3);
    const owned = previous && current.entry !== undefined ? block(original, previous) : undefined;
    const ownerId = previous?.ownerId ?? randomUUID(), newline = original.includes("\r\n") ? "\r\n" : "\n";
    const leadingNewline = owned ? previous?.leadingNewline : original && !original.endsWith("\n") ? newline : undefined;
    const addition = (leadingNewline ?? "") + generatedBlock(entry, ownerId, newline);
    const next = owned ? original.slice(0, owned.start) + addition + original.slice(owned.end) :
      original + addition;
    const after: Receipt = { target: location.target, ownerId, entryDigest: digest(canonicalJson(entry)), blockDigest: digest(addition), packageVersion: "2.0.0", entry,
      ...(leadingNewline ? { leadingNewline } : {}) };
    if (parsed(next).entryDigest !== after.entryDigest) throw new CliError("候选注册条目不一致。", 3);
    if (owned && original.slice(0, owned.start) + original.slice(owned.end) !== next.slice(0, owned.start) + next.slice(owned.start + addition.length)) throw new CliError("非owned字节发生变化。", 3);
    const journal: Journal = { schemaVersion: 1, state: "prepared", target: location.target, operation: "register",
      beforeEntryDigest: current.entryDigest, after, before: previous ?? null, operationId: randomUUID() };
    await writeJson(location.journal, journal);
    await replaceText(location.target, next, originalRead === undefined ? null : digest(original));
    block(await readText(location.target) ?? "", after); ledger.entries[location.key] = after;
    await writeJson(location.receipt, ledger); await writeJson(location.journal, { ...journal, state: "committed" });
    return { state: "pass" as const, evidence: location.target, entryOwnership: "owned", generatedBy, entry };
  }));
}

/** Remove the proved owned byte region only; provider data and every other TOML byte remain intact. */
export async function unregisterCodex(config: string, home?: string) {
  const location = paths(config, home);
  return withFileLock(location.receipt, () => withFileLock(location.target, async () => {
    const ledger = receipts(await readText(location.receipt)); await recover(location.target, location.key, location.receipt, location.journal, ledger);
    const original = await readText(location.target) ?? "", current = parsed(original), previous = ledger.entries[location.key];
    if (current.entry === undefined) { delete ledger.entries[location.key]; await writeJson(location.receipt, ledger); return { state: "pass", reason: "条目已不存在" }; }
    if (!previous) throw new CliError("同名条目没有ownership记录，不能删除。", 3);
    const owned = block(original, previous), next = original.slice(0, owned.start) + original.slice(owned.end);
    if (parsed(next).entry !== undefined) throw new CliError("候选中仍存在owned条目。", 3);
    const journal: Journal = { schemaVersion: 1, state: "prepared", target: location.target, operation: "unregister",
      beforeEntryDigest: current.entryDigest, after: null, before: previous, operationId: randomUUID() };
    await writeJson(location.journal, journal); await replaceText(location.target, next, digest(original));
    delete ledger.entries[location.key]; await writeJson(location.receipt, ledger); await writeJson(location.journal, { ...journal, state: "committed" });
    return { state: "pass", evidence: location.target };
  }));
}
/** Current file evidence only. Saved install/probe results never imply a live Codex connection. */
export async function registrationStatus(config: string, home?: string): Promise<DiagnosticState & { entryOwnership: string }> {
  const location = paths(config, home);
  try {
    const journal = json<Journal | undefined>(await readText(location.journal), undefined);
    if (journal && !["committed", "rolled_back"].includes(journal.state)) return { state: "fail", entryOwnership: "recovery-required",
      reason: "注册事务尚未完成或需要恢复；status只读，未自动修复", nextAction: "capability-graph codex register" };
    const ledger = receipts(await readText(location.receipt)), receipt = ledger.entries[location.key];
    const text = await readText(location.target) ?? "", current = parsed(text);
    if (current.entry === undefined) return { state: "fail", entryOwnership: "absent", reason: "Codex配置中没有此服务", nextAction: "capability-graph codex register" };
    if (!receipt) return { state: "fail", entryOwnership: "external", reason: "同名服务由其他配置拥有", nextAction: "保留该条目并人工处理名称冲突" };
    block(text, receipt);
    if (current.entryDigest !== digest(canonicalJson(installedEntry(config)))) return { state: "fail", entryOwnership: "owned-stale", reason: "条目仍指向旧安装或旧配置", nextAction: "capability-graph codex register" };
    return { state: "pass", entryOwnership: "owned", evidence: location.target };
  } catch (error) { return { state: "fail", entryOwnership: "conflict", reason: error instanceof Error ? error.message : "配置读取失败", nextAction: "检查config.toml和registration.json后重试" }; }
}
