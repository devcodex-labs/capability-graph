import { digest } from './json.js';
import { fail } from './errors.js';
import { forwardKinds } from './schema.js';
import type { LoadedProvider } from './loader.js';
import type { CapabilityDetail, ForwardRelationKind, RelationEdge } from './types.js';

/** Instances are reachable only through Graph's private fields, never query results. */
export class Snapshot {
  readonly providers = new Map<string, LoadedProvider>();
  readonly capabilities = new Map<string, CapabilityDetail>();
  readonly reverse = new Map<string, RelationEdge[]>();
  readonly allowed: ReadonlySet<string>;
  readonly revision: string;
  constructor(providers: LoadedProvider[], allowed?: readonly string[]) {
    for (const provider of providers) {
      const id = provider.summary.providerId;
      if (this.providers.has(id)) fail('CG_DEFINITION_INVALID', 'load', 'Duplicate Provider ID', 'fix_input');
      this.providers.set(id, provider);
      for (const capability of provider.capabilities) this.capabilities.set(capability.id, capability);
    }
    this.allowed = new Set(allowed ?? this.providers.keys());
    for (const capability of this.capabilities.values()) for (const kind of forwardKinds) for (const target of capability.relations[kind]) {
      const providerId = target.split('::')[0]!;
      if (this.providers.has(providerId) && !this.capabilities.has(target)) fail('CG_RELATION_INVALID', 'load', 'A loaded relation endpoint does not exist', 'fix_input');
      const edges = this.reverse.get(target) ?? [];
      edges.push({ from: capability.id, type: kind, to: target }); this.reverse.set(target, edges);
    }
    for (const kind of ['parents', 'specializes', 'requires'] as const) this.assertAcyclic(kind);
    this.revision = digest([...this.providers.values()].filter(p => this.allowed.has(p.summary.providerId)).sort((a, b) => a.summary.providerId < b.summary.providerId ? -1 : 1).map(p => ({ summary: p.summary, capabilities: p.capabilities })));
  }
  private assertAcyclic(kind: ForwardRelationKind): void {
    const colors = new Map<string, 1 | 2>();
    for (const root of this.capabilities.keys()) {
      if (colors.has(root)) continue;
      const stack: Array<{ id: string; position: number }> = [{ id: root, position: 0 }];
      colors.set(root, 1);
      while (stack.length) {
        const current = stack[stack.length - 1]!;
        const targets = this.capabilities.get(current.id)!.relations[kind];
        const target = targets[current.position++];
        if (target === undefined) { colors.set(current.id, 2); stack.pop(); continue; }
        if (!this.capabilities.has(target)) continue;
        if (colors.get(target) === 1) fail('CG_RELATION_CYCLE', 'load', `Cycle in ${kind} relations`, 'fix_input');
        if (!colors.has(target)) { colors.set(target, 1); stack.push({ id: target, position: 0 }); }
      }
    }
  }
}
