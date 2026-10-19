import { Ajv2020 } from 'ajv/dist/2020.js';
import { freezeJSON } from '../json.js';
import type { ValidateFunction } from 'ajv';

const text = { type: 'string', minLength: 1, pattern: '\\S' };
const string = { type: 'string' };
const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const array = (items: unknown, more: Record<string, unknown> = {}) => ({ type: 'array', items, ...more });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
const forward = ['parents', 'specializes', 'related', 'requires'];
const defs: Record<string, unknown> = {
  id: { type: 'string', pattern: '^[a-z][a-z0-9._-]{0,127}$' },
  qid: { type: 'string', pattern: '^[a-z][a-z0-9._-]{0,127}::[a-z][a-z0-9._-]{0,127}$' },
  scalar: { type: ['string', 'number', 'boolean'] },
};
defs.context = object({ facts: { type: 'object', propertyNames: text, additionalProperties: ref('scalar') }, notes: string });
defs.condition = { oneOf: [object({ field: text, op: { const: 'eq' }, value: ref('scalar') }, ['field', 'op', 'value']), object({ field: text, op: { const: 'in' }, values: array(ref('scalar')) }, ['field', 'op', 'values']), object({ field: text, op: { const: 'semverRange' }, range: text }, ['field', 'op', 'range'])] };
defs.rule = object({ all: array(ref('condition')) }, ['all']);
defs.meta = object({ revision: text, completeness: { enum: ['complete', 'partial'] }, warnings: array(object({ code: text, message: string }, ['code', 'message'])) }, ['revision', 'completeness', 'warnings']);
defs.document = object({ id: text, title: string, source: { oneOf: [object({ type: { const: 'file' }, path: text }, ['type', 'path']), object({ type: { const: 'url' }, url: text }, ['type', 'url'])] } }, ['id', 'source']);
defs.usage = object({ instructions: string, input: string, output: string, examples: array(string), contract: object({ format: { enum: ['openapi', 'mcp-tool', 'json-schema', 'other'] }, uri: text }, ['format', 'uri']) });
const catalogFields = { id: ref('qid'), providerId: ref('id'), name: text, description: text, whenToUse: text, appliesTo: ref('rule') };
defs.catalog = object(catalogFields, ['id', 'providerId', 'name', 'description']);
defs.detail = object({ ...catalogFields, usage: ref('usage'), relations: object(Object.fromEntries(forward.map(kind => [kind, array(ref('qid'), { uniqueItems: true })])), forward), documents: array(ref('document')) }, ['id', 'providerId', 'name', 'description', 'relations', 'documents']);
defs.applicability = object({ status: { enum: ['applicable', 'inapplicable', 'unknown'] }, missingFacts: array(string), invalidFacts: array(string), failedConditions: array(string) }, ['status', 'missingFacts', 'invalidFacts', 'failedConditions']);
defs.edge = object({ from: ref('qid'), type: { enum: forward }, to: ref('qid') }, ['from', 'type', 'to']);
defs.unresolved = object({ from: ref('qid'), type: { enum: forward }, to: ref('qid'), reason: { const: 'target_unavailable' } }, ['from', 'type', 'to', 'reason']);
defs.node = object({ capability: ref('detail'), applicability: ref('applicability'), origin: { enum: ['selected', 'dependency', 'relation'] } }, ['capability', 'applicability', 'origin']);
defs.resolve = object({ selected: array(ref('qid'), { uniqueItems: true }), nodes: array(ref('node')), edges: array(ref('edge')), unresolved: array(ref('unresolved')), meta: ref('meta') }, ['selected', 'nodes', 'edges', 'unresolved', 'meta']);
const scope = { providers: array(ref('id')) };
const roots = { ids: array(ref('qid'), { minItems: 1 }), context: ref('context') };
export const toolShapes = {
  list_providers: { input: object(scope), output: object({ items: array(object({ providerId: ref('id'), name: text, version: text, description: string, capabilityCount: { type: 'integer', minimum: 0 } }, ['providerId', 'name', 'version', 'capabilityCount'])), meta: ref('meta') }, ['items', 'meta']) },
  list_catalog: { input: object(scope), output: object({ items: array(ref('catalog')), meta: ref('meta') }, ['items', 'meta']) },
  get_capabilities: { input: object(roots, ['ids']), output: object({ items: array(object({ capability: ref('detail'), applicability: ref('applicability') }, ['capability', 'applicability'])), meta: ref('meta') }, ['items', 'meta']) },
  resolve: { input: object({ ...roots, relations: array({ enum: [...forward, 'children', 'specializedBy', 'relatedBy', 'requiredBy'] }) }, ['ids']), output: ref('resolve') },
  read_document: { input: object({ capabilityId: ref('qid'), documentId: text }, ['capabilityId', 'documentId']), output: object({ capabilityId: ref('qid'), documentId: text, source: object({ type: { const: 'file' }, path: text }, ['type', 'path']), text: string, byteLength: { type: 'integer', minimum: 0 }, contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, meta: ref('meta') }, ['capabilityId', 'documentId', 'source', 'text', 'byteLength', 'contentHash', 'meta']) },
  match: { input: object({ input: text, context: ref('context'), ...scope }, ['input']), output: object({ status: { enum: ['matched', 'no_match', 'ambiguous', 'needs_context'] }, selection: object({ ids: array(ref('qid'), { uniqueItems: true }), reason: string, missingInformation: array(string) }, ['ids', 'missingInformation']), graph: ref('resolve') }, ['status', 'selection', 'graph']) },
};
export type ToolKey = keyof typeof toolShapes;
export function standalone(shape: unknown): Record<string, unknown> {
  const root = shape as Record<string, unknown>;
  const expanded = typeof root.$ref === 'string' ? defs[root.$ref.slice('#/$defs/'.length)] : root;
  return freezeJSON({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...(expanded as object), $defs: defs });
}
const validator = new Ajv2020({ strict: true, allowUnionTypes: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
export const outputChecks = new Map<ToolKey, ValidateFunction>(Object.entries(toolShapes).map(([name, shape]) => [name as ToolKey, validator.compile(standalone(shape.output))]));
