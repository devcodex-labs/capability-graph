import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderRecord, UnvalidatedProviderSnapshot } from "./types.js";

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
        return JSON.parse(await readFile(resolved, "utf8")) as unknown;
      } catch {
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
          if (entry.isDirectory() && !["node_modules", "dist"].includes(entry.name)) directories.push(file);
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
