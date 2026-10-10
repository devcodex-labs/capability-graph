import { createRequire } from "node:module";
import { realpath, open, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CapabilityGraphError } from "../errors.js";
import { resolveProviderRelative } from "./path-guard.js";

/** Host declarations, never taken from document locators or sent to a retriever. */
export type KnowledgeRootSpec = { readonly kind: "directory"; readonly rootDir: string } |
  { readonly kind: "package"; readonly packageName: string; readonly resolveFrom: string };
export interface BoundKnowledgeRoot { readonly rootDir: string; readonly identity: string }
export type BoundKnowledgeRoots = Readonly<Record<string, BoundKnowledgeRoot>>;
export type KnowledgeRootContext = string | { readonly defaultRoot?: string; readonly aliases: BoundKnowledgeRoots };
export const rootAliasValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
export function knowledgeRoot(context: KnowledgeRootContext | undefined, alias?: string): string | undefined {
  if (alias === undefined) return typeof context === "string" ? context : context?.defaultRoot;
  return typeof context === "object" ? context.aliases[alias]?.rootDir : undefined;
}
async function packageManifest(root: string): Promise<Buffer> {
  const handle = await open(await resolveProviderRelative(root, "package.json", true), "r");
  try {
    const before = await handle.stat({ bigint: true });
    const check = await open(await resolveProviderRelative(root, "package.json", true), "r");
    let verified: typeof before;
    try { verified = await check.stat({ bigint: true }); } finally { await check.close(); }
    if (before.dev !== verified.dev || before.ino !== verified.ino) throw new Error("Package manifest replaced");
    if (!before.isFile() || before.size > 262144n) throw new Error("Invalid package manifest");
    const buffer = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < buffer.length) { const part = await handle.read(buffer, length, buffer.length - length, null); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await handle.stat({ bigint: true });
    if (BigInt(length) !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("Package manifest changed");
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
/** An in-place package replacement must not be read as the pinned package identity. */
export async function assertKnowledgeRoot(roots: BoundKnowledgeRoots | undefined, alias?: string): Promise<void> {
  if (alias === undefined) return;
  const binding = roots?.[alias];
  try {
    if (!binding || await realpath(binding.rootDir) !== binding.rootDir) throw new Error("Root replaced");
    if (binding.identity.startsWith("package:")) {
      const digest = createHash("sha256").update(await packageManifest(binding.rootDir)).digest("hex");
      if (!binding.identity.endsWith(`:${digest}`)) throw new Error("Package identity changed");
    }
  } catch { throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "refresh", details: { reason: "knowledge_root_identity_changed", root: alias } }); }
}
export async function bindKnowledgeRoots(specs: Readonly<Record<string, KnowledgeRootSpec>> = {}): Promise<BoundKnowledgeRoots> {
  const result: Record<string, BoundKnowledgeRoot> = Object.create(null);
  for (const [alias, spec] of Object.entries(specs)) {
    try {
      let root: string; let identity: string;
      if (spec.kind === "directory") {
        root = await realpath(spec.rootDir); identity = "directory";
      } else {
        const require = createRequire(path.join(spec.resolveFrom, "__cg_package_resolution__.cjs"));
        const candidates = require.resolve.paths(spec.packageName) ?? [];
        let found: string | undefined;
        for (const directory of candidates) {
          try { found = await realpath(path.join(directory, spec.packageName)); break; } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          }
        }
        if (!found) throw new Error("Package absent");
        root = found;
        const bytes = await packageManifest(root); const manifest = JSON.parse(bytes.toString()) as { name: string; version: string };
        if (manifest.name !== spec.packageName || typeof manifest.version !== "string") throw new Error("Package identity mismatch");
        identity = `package:${manifest.name}@${manifest.version}:${createHash("sha256").update(bytes).digest("hex")}`;
      }
      if (!(await stat(root)).isDirectory()) throw new Error("Root must be a directory");
      result[alias] = Object.freeze({ rootDir: root, identity });
    } catch { throw new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend", details: { knowledgeRoot: alias } }); }
  }
  return Object.freeze(result);
}
