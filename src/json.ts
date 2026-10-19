import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { fail } from './errors.js';
import type { ErrorPhase } from './types.js';

export function descriptors(value: unknown, code: string, phase: ErrorPhase): Record<string, PropertyDescriptor> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) fail(code, phase, 'Expected a plain object', 'fix_input');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code, phase, 'Expected a plain object', 'fix_input');
  if (Object.getOwnPropertySymbols(value).length) fail(code, phase, 'Symbol properties are not JSON', 'fix_input');
  const result = Object.getOwnPropertyDescriptors(value);
  for (const item of Object.values(result)) if (!Object.hasOwn(item, 'value') || !item.enumerable) fail(code, phase, 'Accessors and hidden properties are not JSON', 'fix_input');
  return result;
}

/** Copy only JSON data; reject proxies before inspecting potentially trapped descriptors. */
export function copyJSON<T>(value: T, code = 'CG_INPUT_INVALID', phase: ErrorPhase = 'query'): T {
  const active = new Set<object>();
  const visit = (v: unknown): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || !v || types.isProxy(v) || active.has(v) || active.size > 64) fail(code, phase, 'Expected finite, acyclic JSON data within the declared schema nesting', 'fix_input');
    active.add(v);
    let out: unknown;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1) fail(code, phase, 'Sparse or extended arrays are not JSON', 'fix_input');
      const items: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail(code, phase, 'Array accessors and holes are not JSON', 'fix_input');
        items.push(visit(d.value));
      }
      out = items;
    } else {
      const obj: Record<string, unknown> = {};
      for (const [key, d] of Object.entries(descriptors(v, code, phase))) Object.defineProperty(obj, key, { value: visit(d.value), enumerable: true, writable: true, configurable: true });
      out = obj;
    }
    active.delete(v); return out;
  };
  return visit(value) as T;
}
export function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function digest(value: unknown): string { return 'sha256:' + createHash('sha256').update(canonical(value)).digest('hex'); }
export function freezeJSON<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeJSON(item); Object.freeze(value); }
  return value;
}
