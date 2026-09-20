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
          // Read one byte beyond the record budget so oversized definitions fail before JSON parsing or allocation growth.
          const bytes = Buffer.allocUnsafe(RECORD_MAX_BYTES + 1);
          let length = 0;
          while (length < bytes.length) {
            const result = await handle.read(bytes, length, bytes.length - length, length);
            if (!result.bytesRead) break;
            length += result.bytesRead;
          }
          if (length > RECORD_MAX_BYTES) {
            throw new CapabilityGraphError("CG_BUDGET_EXCEEDED", {
              nextAction: "repair_source", details: { file, maxBytes: RECORD_MAX_BYTES },
            });
          }
          return JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown;
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
    const capabilities: UnvalidatedCapabilityRecord[] = [];
    for (const file of files.sort()) capabilities.push(await read(file) as UnvalidatedCapabilityRecord);
    return { source: { kind: "file", rootDir: root }, provider, capabilities, knowledgeRootDir: root };
  }
}
