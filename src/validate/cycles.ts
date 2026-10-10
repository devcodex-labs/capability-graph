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
 * Each frame owns an edge iterator, so database traversal can retain one bounded relation page.
 * File records are already retained by the memory store. Related cycles are intentionally allowed.
 */
export async function validateCycles(ids: ReadonlySet<string>, read: (id: string) => Promise<CapabilityRecord>,
  readEdges?: (id: string, relation: "parents" | "specializes" | "requires") => AsyncIterable<string>): Promise<void> {
  for (const relation of ["parents", "specializes", "requires"] as const) {
    const color = new Map<string, number>();
    for (const id of ids) {
      if (color.has(id)) continue;
      const stack: { id: string; edges: AsyncIterator<string> }[] = [];
      const push = (key: string) => {
        const edges = readEdges ? readEdges(key, relation) : (async function* () { yield* (await read(key))[relation]; })();
        stack.push({ id: key, edges: edges[Symbol.asyncIterator]() }); color.set(key, 1);
      };
      push(id);
      try {
        while (stack.length) {
          const frame = stack[stack.length - 1]!;
          const edge = await frame.edges.next();
          if (edge.done) { color.set(frame.id, 2); stack.pop(); continue; }
          const target = edge.value;
          if (color.get(target) === 1) {
            const start = stack.findIndex((item) => item.id === target);
            throw new CapabilityGraphError("CG_RELATION_CYCLE", { nextAction: "repair_source",
              details: { relation, cycle: [...stack.slice(start).map((item) => item.id), target] } });
          }
          if (!color.has(target)) push(target);
        }
      } finally {
        // Release suspended bounded pages without replacing the primary validation failure.
        await Promise.allSettled(stack.map((frame) => frame.edges.return?.()));
      }
    }
  }
}
