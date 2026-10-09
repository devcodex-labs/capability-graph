import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";
import { RECORD_MAX_BYTES } from "../validate/values.js";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderRecord, UnvalidatedProviderSnapshot } from "./types.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "dist-test", "coverage", ".cache", ".tmp"]);

/** File authority reads definitions only, never application entrypoints or knowledge bodies. */
export class FileAuthorityStore {
  async load(rootDir: string): Promise<UnvalidatedProviderSnapshot> {
    const root = path.resolve(rootDir);
    const read = async (file: string): Promise<unknown> => {
      try {
        const resolved = await realpath(path.join(root, file));
        const relative = path.relative(await realpath(root), resolved);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error("Definition outside provider root");
        }
        const handle = await open(resolved, "r");
        try {
          const before = await handle.stat({ bigint: true });
          if (!before.isFile()) throw new Error("Definition must be a file");
          if (before.size > BigInt(RECORD_MAX_BYTES)) throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", {
            nextAction: "repair_source", details: { file, maxBytes: RECORD_MAX_BYTES },
          });
          const verifiedPath = await realpath(path.join(root, file));
          const verifiedRelative = path.relative(await realpath(root), verifiedPath);
          if (verifiedRelative === ".." || verifiedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(verifiedRelative)) throw new Error("Definition outside provider root");
          const check = await open(verifiedPath, "r");
          try {
            const verified = await check.stat({ bigint: true });
            if (before.dev !== verified.dev || before.ino !== verified.ino) throw new Error("Definition changed");
          } finally { await check.close(); }
          const bytes = Buffer.allocUnsafe(Math.max(1, Math.min(Number(before.size) + 1, 16384)));
          const chunks: Buffer[] = [];
          let length = 0;
          while (length <= RECORD_MAX_BYTES) {
            const result = await handle.read(bytes, 0, Math.min(bytes.length, RECORD_MAX_BYTES + 1 - length), length);
            if (!result.bytesRead) break;
            length += result.bytesRead;
            chunks.push(Buffer.from(bytes.subarray(0, result.bytesRead)));
          }
          if (length > RECORD_MAX_BYTES) {
            throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", {
              nextAction: "repair_source", details: { file, maxBytes: RECORD_MAX_BYTES },
            });
          }
          const after = await handle.stat({ bigint: true });
          if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(length) !== after.size) throw new Error("Definition changed");
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length))) as unknown;
        } finally { await handle.close(); }
      } catch (error) {
        if (error instanceof CapabilityGraphError) throw error;
        throw new CapabilityGraphError("CG_LOAD_FAILED", { nextAction: "repair_source", details: { file } });
      }
    };
    const provider = await read("provider.json") as UnvalidatedProviderRecord;
    const files: string[] = [];
    const directories = [""];
    while (directories.length) {
      const current = directories.pop()!;
      try {
        for (const entry of await readdir(path.join(root, current), { withFileTypes: true })) {
          const file = path.posix.join(current, entry.name);
          if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) directories.push(file);
          else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".capability.json")) files.push(file);
        }
      } catch {
        throw new CapabilityGraphError("CG_LOAD_FAILED", { nextAction: "repair_source", details: { file: current || "." } });
      }
    }
    files.sort();
    const capabilities: UnvalidatedCapabilityRecord[] = new Array(files.length);
    const failures: { index: number; error: unknown }[] = []; let next = 0;
    // A shared load has at most eight reads. Stop dispatching after failure and join all started I/O.
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (!failures.length && next < files.length) {
        const index = next++;
        try { capabilities[index] = await read(files[index]!) as UnvalidatedCapabilityRecord; }
        catch (error) { failures.push({ index, error }); }
      }
    }));
    if (failures.length) throw failures.sort((a, b) => a.index - b.index)[0]!.error;
    return { source: { kind: "file", rootDir: root }, provider, capabilities, knowledgeRootDir: root };
  }
}
