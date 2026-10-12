import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, rename, unlink, lstat } from "node:fs/promises";
import { Ajv } from "ajv";
import { CapabilityGraph, type OpenConfig } from "../capability-graph.js";
import type { ProviderLoadSpec } from "../core-host.js";
import { isId } from "../identity.js";
import { rootAliasValid } from "../knowledge/roots.js";
import { resolveBudgets, type BudgetOverrides } from "../budgets.js";
import { HttpKnowledgeReader, type HttpKnowledgeReaderOptions } from "../readers/http.js";
import type { HttpServerOptions } from "../mcp/server.js";

/** CLI failures have stable process exits: usage/config=2, ownership/concurrent-file conflict=3. */
export class CliError extends Error { constructor(message: string, readonly exitCode = 2) { super(message); } }
export interface CliProvider extends ProviderLoadSpec { readonly enabled?: boolean }
export interface CliConfig { readonly schemaVersion: 1; readonly providers: readonly CliProvider[];
  readonly budgets?: BudgetOverrides; readonly httpReader?: HttpKnowledgeReaderOptions; readonly http?: HttpServerOptions }
export const configPath = (file?: string) => path.resolve(file ?? path.join(os.homedir(), ".capability-graph", "config.json"));
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const string = { type: "string", minLength: 1 }, positive = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const timerMs = { ...positive, maximum: 2_147_483_647 };
const object = (properties: object, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const strings = { type: "array", items: string, uniqueItems: true };
const schema = object({ schemaVersion: { const: 1 }, providers: { type: "array", maxItems: 128, items: object({
  providerId: string, enabled: { type: "boolean" }, authority: object({ kind: { const: "file" }, rootDir: string,
    definitionLayout: { enum: ["directory", "legacy"] } }, ["kind", "rootDir"]),
  knowledgeRoots: { type: "object", additionalProperties: { oneOf: [
    object({ kind: { const: "directory" }, rootDir: string }, ["kind", "rootDir"]),
    object({ kind: { const: "package" }, packageName: string, resolveFrom: string }, ["kind", "packageName", "resolveFrom"]),
  ] } },
}, ["providerId", "authority"]) }, budgets: { type: "object" },
  httpReader: object({ allowedOrigins: { ...strings, minItems: 1 }, timeoutMs: timerMs, maxConcurrent: positive,
    snapshot: object({ directory: string, maxBytes: positive, maxEntries: positive, ttlMs: positive }, ["directory"]) }, ["allowedOrigins"]),
  http: object({ host: string, port: { type: "integer", minimum: 1, maximum: 65535 }, path: string,
    allowedOrigins: strings, allowedHostnames: strings, bearerToken: string, allowedProviders: strings,
    limits: object({ maxClients: positive, maxInFlight: positive, maxBodyBytes: positive, requestTimeoutMs: timerMs,
      drainTimeoutMs: timerMs, maxToolResultBytes: positive }) }),
}, ["schemaVersion", "providers"]);
const validate = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(schema);

/** Normalize paths against the configuration directory, never the later service cwd. Core still validates source identities. */
export function normalizeConfig(value: unknown, file: string): CliConfig {
  if (!validate(value)) throw new CliError("配置必须是schemaVersion=1，且只能包含已声明字段。运行 capability-graph --help 查看配置用法。");
  const input = value as unknown as CliConfig, base = path.dirname(path.resolve(file)); const seen = new Set<string>();
  const providers = input.providers.map(provider => {
    if (!isId(provider.providerId) || Object.keys(provider.knowledgeRoots ?? {}).some(alias => !rootAliasValid(alias))) throw new CliError("Provider身份或文档根别名无效。");
    if (seen.has(provider.providerId)) throw new CliError(`Provider重复：${provider.providerId}`); seen.add(provider.providerId);
    const roots = provider.knowledgeRoots === undefined ? undefined : Object.fromEntries(Object.entries(provider.knowledgeRoots).map(([alias, root]) => [alias,
      root.kind === "directory" ? { ...root, rootDir: path.resolve(base, root.rootDir) } : { ...root, resolveFrom: path.resolve(base, root.resolveFrom) }]));
    return { ...provider, enabled: provider.enabled ?? true, authority: { ...provider.authority, rootDir: path.resolve(base, provider.authority.rootDir) },
      ...(roots ? { knowledgeRoots: roots } : {}) };
  });
  const budgets = (() => { try { return resolveBudgets(input.budgets); }
    catch (error) { throw new CliError(`budgets配置无效：${error instanceof Error ? error.message : String(error)}`); } })();
  const httpReader = input.httpReader === undefined ? undefined : { ...input.httpReader,
    ...(input.httpReader.snapshot ? { snapshot: { ...input.httpReader.snapshot, directory: path.resolve(base, input.httpReader.snapshot.directory) } } : {}) };
  if (httpReader) {
    // SDK validation is a CLI configuration failure, not an internal process failure.
    try { new HttpKnowledgeReader(httpReader); }
    catch (error) { throw new CliError(`httpReader配置无效：${error instanceof Error ? error.message : String(error)}`); }
    if (httpReader.snapshot) for (const provider of providers) {
      const roots = [provider.authority.rootDir, ...Object.values(provider.knowledgeRoots ?? {}).flatMap(root => root.kind === "directory" ? [root.rootDir] : [])];
      if (roots.some(root => { const relative = path.relative(root, httpReader.snapshot!.directory); return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`); }))
        throw new CliError("snapshot.directory必须位于Provider和文档源目录之外。");
    }
  }
  return { schemaVersion: 1, providers, budgets, ...(httpReader ? { httpReader } : {}), ...(input.http ? { http: input.http } : {}) };
}

/** Bounded UTF-8 config/journal reads. Missing files are distinguished from invalid or inaccessible files. */
export async function readText(file: string, maximum = 1_048_576): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink()) throw new CliError(`配置目标必须是普通文件：${file}`, 3);
    handle = await open(file, "r"); if ((await handle.stat()).size > maximum) throw new CliError(`文件超过${maximum}字节：${file}`);
    const bytes = Buffer.alloc(maximum + 1); let used = 0;
    while (used < bytes.length) { const { bytesRead } = await handle.read(bytes, used, bytes.length - used); if (!bytesRead) break; used += bytesRead; }
    if (used > maximum) throw new CliError(`文件超过${maximum}字节：${file}`);
    // Preserve every byte in TOML ownership/CAS; parsers may ignore a leading BOM separately.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, used));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  finally { await handle?.close(); }
}
export async function loadConfig(file: string, allowMissing = false) {
  const text = await readText(file);
  if (text === undefined && !allowMissing) throw new CliError(`未找到配置：${file}。先运行 provider add，或创建 {"schemaVersion":1,"providers":[]}。`);
  let raw: unknown;
  try { raw = text === undefined ? { schemaVersion: 1, providers: [] } : JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new CliError(`配置JSON无效：${file}`); }
  const config = normalizeConfig(raw, file);
  return { config, originalDigest: text === undefined ? null : digest(text), configDigest: digest(JSON.stringify(config)) };
}

/** Only this CLI's file writers cooperate with this lock; external editors are checked by byte CAS immediately before rename. */
export async function withFileLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true }); const lock = `${file}.capability-graph.lock`, token = randomUUID();
  const until = Date.now() + 5000; let handle: Awaited<ReturnType<typeof open>>;
  while (true) {
    try { handle = await open(lock, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const text = await readText(lock, 4096);
      try {
        const record = JSON.parse(text ?? "{}");
        if (Number.isSafeInteger(record.pid) && record.pid > 0) {
          try { process.kill(record.pid, 0); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code === "ESRCH" && await readText(lock, 4096) === text) { await unlink(lock); continue; } }
        }
      } catch { /* An incomplete live writer is not a stale lock we may remove. */ }
      if (Date.now() >= until) throw new CliError(`文件事务繁忙：${file}，请稍后重试。`, 3);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); return await operation(); }
  finally { await handle.close(); const text = await readText(lock, 4096); if (text && JSON.parse(text).token === token) await unlink(lock); }
}

/** Flush a same-directory candidate, verify expected original bytes, rename atomically, then read back. No whole-file rollback. */
export async function replaceText(file: string, text: string, expectedDigest: string | null): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true }); const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const previous = await readText(file); const current = previous === undefined ? null : digest(previous);
    if (current !== expectedDigest) throw new CliError(`文件已被其他写入者修改：${file}`, 3);
    const handle = await open(temporary, "wx", previous === undefined ? 0o600 : (await lstat(file)).mode);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    const latest = await readText(file); if ((latest === undefined ? null : digest(latest)) !== expectedDigest) throw new CliError(`文件并发冲突：${file}`, 3);
    await rename(temporary, file);
    if (await readText(file) !== text) throw new CliError(`事务读回不一致：${file}`, 3);
  } finally { try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
export async function saveConfig(file: string, config: CliConfig, expectedDigest: string | null) {
  const normalized = normalizeConfig(config, file);
  await withFileLock(file, () => replaceText(file, JSON.stringify(normalized, null, 2) + "\n", expectedDigest));
}
/** A startup owns its Reader and graph; stop transports before closing these resources. */
export async function openConfigured(file: string) {
  const loaded = await loadConfig(file), enabled = loaded.config.providers.filter(provider => provider.enabled !== false);
  const reader = loaded.config.httpReader ? new HttpKnowledgeReader(loaded.config.httpReader) : undefined;
  const open: OpenConfig = { hostAllowedProviders: enabled.map(provider => provider.providerId), integrationEnabledProviders: enabled.map(provider => provider.providerId),
    providers: enabled, budgets: loaded.config.budgets, ...(reader ? { readers: [reader] } : {}) };
  try {
    const graph = await CapabilityGraph.open(open);
    return { ...loaded, graph, reader, async close() { try { await reader?.close(); } finally { await graph.close(); } } };
  } catch (error) { await reader?.close(); throw error; }
}
