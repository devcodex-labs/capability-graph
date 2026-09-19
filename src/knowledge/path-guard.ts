import { realpath } from "node:fs/promises";
import path from "node:path";
import { CapabilityGraphError } from "../errors.js";

function traversal(relative: string): never {
  throw new CapabilityGraphError("CG_PATH_TRAVERSAL", { nextAction: "repair_source", details: { path: relative } });
}

/** Reject lexical escapes before touching the filesystem, even when the target is absent. */
export function assertProviderRelative(relative: string): readonly string[] {
  if (typeof relative !== "string" || !relative || /[\\:~]/.test(relative)) traversal(relative);
  const segments = relative.split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..")) {
    traversal(relative);
  }
  return segments;
}

/** Existing targets must remain in the real root; missing knowledge is valid at load time. */
export async function resolveProviderRelative(root: string, relative: string, required = false): Promise<string> {
  const segments = assertProviderRelative(relative);
  const candidate = path.resolve(root, ...segments);
  try {
    const realTarget = await realpath(candidate);
    const realRoot = await realpath(root);
    const child = path.relative(realRoot, realTarget);
    if (child === ".." || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) traversal(relative);
    return realTarget;
  } catch (error) {
    if (error instanceof CapabilityGraphError) throw error;
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (missing && !required) return candidate;
    throw new CapabilityGraphError("CG_SOURCE_UNREADABLE", { nextAction: "repair_source", details: { path: relative } });
  }
}
