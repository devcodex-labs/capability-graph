import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ProviderDefinition } from './types.js';

export const ID = /^[a-z][a-z0-9._-]{0,127}$/;
export const QID = /^[a-z][a-z0-9._-]{0,127}::[a-z][a-z0-9._-]{0,127}$/;
export const forwardKinds = ['parents', 'specializes', 'related', 'requires'] as const;
export const relationKinds = [...forwardKinds, 'children', 'specializedBy', 'relatedBy', 'requiredBy'] as const;
const text = { type: 'string', minLength: 1, pattern: '\\S' };
const scalar = { type: ['string', 'number', 'boolean'] };
function object(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> { return { type: 'object', properties, required, additionalProperties: false }; }
const array = (items: unknown) => ({ type: 'array', items });
const reference = { type: 'string', pattern: '^[a-z][a-z0-9._-]{0,127}(::[a-z][a-z0-9._-]{0,127})?$' };
const condition = { oneOf: [
  object({ field: text, op: { const: 'eq' }, value: scalar }, ['field', 'op', 'value']),
  object({ field: text, op: { const: 'in' }, values: array(scalar) }, ['field', 'op', 'values']),
  object({ field: text, op: { const: 'semverRange' }, range: text }, ['field', 'op', 'range']),
] };
const document = object({ id: text, title: { type: 'string' }, source: { oneOf: [
  object({ type: { const: 'file' }, path: text }, ['type', 'path']),
  object({ type: { const: 'url' }, url: text }, ['type', 'url']),
] } }, ['id', 'source']);
const usage = object({ instructions: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, examples: array({ type: 'string' }), contract: object({ format: { enum: ['openapi', 'mcp-tool', 'json-schema', 'other'] }, uri: text }, ['format', 'uri']) });
const capability = object({ id: { type: 'string', pattern: ID.source }, name: text, description: text, whenToUse: text, usage, appliesTo: object({ all: array(condition) }, ['all']), relations: object(Object.fromEntries(forwardKinds.map(k => [k, array(reference)]))), documents: array(document) }, ['id', 'name', 'description']);
export const providerSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...object({ schemaVersion: { const: 1 }, providerId: { type: 'string', pattern: ID.source }, name: text, version: text, description: { type: 'string' }, capabilities: array(capability) }, ['providerId', 'name', 'version', 'capabilities']) };
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, coerceTypes: false, removeAdditional: false, useDefaults: false, allErrors: true });
export const validateProvider = ajv.compile<ProviderDefinition>(providerSchema);
