import { CapabilityGraphError } from "../errors.js";
import type { CapabilityRecord } from "./schema.js";
import { invalid } from "./values.js";

/** Run only after the complete ID inventory exists; forward references are legal. */
export function validateEndpoints(record: CapabilityRecord, ids: ReadonlySet<string>): void {
  for (const relation of ["parents", "specializes", "related", "requires"] as const) {
    for (const endpoint of record[relation]) if (!ids.has(endpoint)) invalid({ endpoint, relation });
  }
}

/**
 * Iterative DFS avoids call-stack overflow and retaining database definitions along the stack.
 * Gray (1) is on the current path; black (2) is fully explored. Relation kinds use independent colors.
 * Re-reading each frame trades adapter reads for bounded retained state; related cycles are intentionally allowed.
 */
export async function validateCycles(ids: ReadonlySet<string>, read: (id: string) => Promise<CapabilityRecord>): Promise<void> {
  for (const relation of ["parents", "specializes", "requires"] as const) {
    const color = new Map<string, number>();
    for (const id of ids) {
      if (color.has(id)) continue;
      const stack = [{ id, next: 0 }];
      color.set(id, 1);
      while (stack.length) {
        const frame = stack[stack.length - 1]!;
        const edges = (await read(frame.id))[relation];
        if (frame.next >= edges.length) { color.set(frame.id, 2); stack.pop(); continue; }
        const target = edges[frame.next++]!;
        if (color.get(target) === 1) {
          const start = stack.findIndex((item) => item.id === target);
          throw new CapabilityGraphError("CG_RELATION_CYCLE", { nextAction: "repair_source",
            details: { relation, cycle: [...stack.slice(start).map((item) => item.id), target] } });
        }
        if (!color.has(target)) { color.set(target, 1); stack.push({ id: target, next: 0 }); }
      }
    }
  }
}
