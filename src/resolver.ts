import { applicability } from './applicability.js';
import type { Snapshot } from './snapshot.js';
import type { MatchContext, RelationKind, RelationEdge, ResolveResult, ResolvedNode, UnresolvedEdge } from './types.js';

const reverseKind = { children: 'parents', specializedBy: 'specializes', relatedBy: 'related', requiredBy: 'requires' } as const;
const priority = { selected: 0, dependency: 1, relation: 2 } as const;
const key = (edge: RelationEdge) => JSON.stringify([edge.from, edge.type, edge.to]);
const order = (a: RelationEdge, b: RelationEdge) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
export function resolveSnapshot(snapshot: Snapshot, ids: string[], ctx: MatchContext, relations: RelationKind[]): ResolveResult {
  const nodes = new Map<string, ResolvedNode>();
  const edges = new Map<string, RelationEdge>();
  const unresolved = new Map<string, UnresolvedEdge>();
  function add(id: string, origin: ResolvedNode['origin']): void {
    const previous = nodes.get(id);
    if (previous && priority[previous.origin] <= priority[origin]) return;
    const capability = snapshot.capabilities.get(id)!;
    nodes.set(id, { capability, origin, applicability: applicability(capability.appliesTo, ctx) });
  }
  function forward(edge: RelationEdge, origin: ResolvedNode['origin']): boolean {
    const target = snapshot.capabilities.get(edge.to);
    if (!target || !snapshot.allowed.has(target.providerId)) {
      unresolved.set(key(edge), { ...edge, reason: 'target_unavailable' }); return false;
    }
    add(edge.to, origin); edges.set(key(edge), edge); return true;
  }
  for (const id of ids) add(id, 'selected');
  if (relations.includes('requires')) {
    const visited = new Set<string>(); const queue = [...ids];
    for (let position = 0; position < queue.length; position++) {
      const from = queue[position]!;
      if (visited.has(from)) continue;
      visited.add(from);
      for (const to of snapshot.capabilities.get(from)!.relations.requires) if (forward({ from, type: 'requires', to }, 'dependency') && !visited.has(to)) queue.push(to);
    }
  }
  for (const id of ids) for (const relation of relations) {
    if (relation === 'requires') continue;
    if (Object.hasOwn(reverseKind, relation)) {
      for (const edge of snapshot.reverse.get(id) ?? []) {
        if (edge.type !== reverseKind[relation as keyof typeof reverseKind]) continue;
        const from = snapshot.capabilities.get(edge.from)!;
        if (!snapshot.allowed.has(from.providerId)) continue; // No warning, count or partial for hidden sources.
        add(edge.from, 'relation'); edges.set(key(edge), edge);
      }
    } else for (const to of snapshot.capabilities.get(id)!.relations[relation as 'parents' | 'specializes' | 'related']) forward({ from: id, type: relation as 'parents' | 'specializes' | 'related', to }, 'relation');
  }
  return { selected: ids, nodes: [...nodes.values()].sort((a, b) => a.capability.id < b.capability.id ? -1 : a.capability.id > b.capability.id ? 1 : 0), edges: [...edges.values()].sort(order), unresolved: [...unresolved.values()].sort(order), meta: { revision: snapshot.revision, completeness: unresolved.size ? 'partial' : 'complete', warnings: [] } };
}
