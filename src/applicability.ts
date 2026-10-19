import { fail } from './errors.js';
import { copyJSON, descriptors } from './json.js';
import type { ApplicabilityRule, ApplicabilityResult, MatchContext } from './types.js';

const versionPattern = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
const versionRegex = new RegExp('^' + versionPattern + '$');
const comparisonRegex = new RegExp('^(>=|<=|>|<|=)?' + versionPattern + '$');
type Version = [bigint, bigint, bigint];
function version(value: unknown): Version | undefined {
  if (typeof value !== 'string') return;
  const match = versionRegex.exec(value);
  return match ? [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)] : undefined;
}
function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}
export function parseRange(range: string): Array<{ op: string; target: Version }> | undefined {
  if (!range.trim()) return;
  const result: Array<{ op: string; target: Version }> = [];
  for (const term of range.trim().split(/\s+/)) {
    const match = comparisonRegex.exec(term);
    if (!match) return;
    result.push({ op: match[1] ?? '=', target: [BigInt(match[2]!), BigInt(match[3]!), BigInt(match[4]!)] });
  }
  return result;
}
export function context(value: unknown): MatchContext {
  if (value === undefined) return {};
  const data = copyJSON(value, 'CG_CONTEXT_INVALID', 'query');
  const keys = descriptors(data, 'CG_CONTEXT_INVALID', 'query');
  if (Object.keys(keys).some(k => !['facts', 'notes'].includes(k))) fail('CG_CONTEXT_INVALID', 'query', 'Unknown context field', 'fix_input');
  if (keys.notes && typeof keys.notes.value !== 'string') fail('CG_CONTEXT_INVALID', 'query', 'Context notes must be text', 'fix_input');
  if (keys.facts) {
    for (const [key, descriptor] of Object.entries(descriptors(keys.facts.value, 'CG_CONTEXT_INVALID', 'query'))) {
      const v = descriptor.value;
      if (!key.trim() || !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) fail('CG_CONTEXT_INVALID', 'query', 'Facts require nonempty keys and finite scalar values', 'fix_input');
    }
  }
  return data as MatchContext;
}
export function applicability(rule: ApplicabilityRule | undefined, ctx: MatchContext): ApplicabilityResult {
  const result: ApplicabilityResult = { status: 'applicable', missingFacts: [], invalidFacts: [], failedConditions: [] };
  for (const condition of rule?.all ?? []) {
    if (!ctx.facts || !Object.hasOwn(ctx.facts, condition.field)) { result.missingFacts.push(condition.field); continue; }
    const fact = ctx.facts[condition.field];
    let ok: boolean;
    if (condition.op === 'eq') ok = fact === condition.value;
    else if (condition.op === 'in') ok = condition.values.some(value => value === fact);
    else {
      const v = version(fact);
      if (!v) { result.invalidFacts.push(condition.field); continue; }
      ok = parseRange(condition.range)!.every(({ op, target }) => {
        const c = compare(v, target);
        return op === '=' ? c === 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '<' ? c < 0 : c <= 0;
      });
    }
    if (!ok) result.failedConditions.push(condition.field);
  }
  for (const key of ['missingFacts', 'invalidFacts', 'failedConditions'] as const) result[key] = [...new Set(result[key])].sort();
  result.status = result.failedConditions.length ? 'inapplicable' : result.missingFacts.length || result.invalidFacts.length ? 'unknown' : 'applicable';
  return result;
}
