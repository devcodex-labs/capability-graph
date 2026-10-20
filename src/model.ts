import { GraphError, fail } from './errors.js';
import { copyJSON, bytes } from './json.js';
import type { ModelSelection, NextAction } from './types.js';

const modelCodes = new Set(['CG_MODEL_UNAVAILABLE', 'CG_MODEL_TIMEOUT', 'CG_MODEL_CANCELLED', 'CG_MODEL_REFUSED', 'CG_MODEL_OUTPUT_INVALID', 'CG_MODEL_OUTPUT_TOO_LARGE', 'CG_MODEL_INVALID_SELECTION', 'CG_MODEL_CONTEXT_EXCEEDED', 'CG_MODEL_EXECUTOR_UNSAFE']);
const modelActions = new Set<NextAction>(['fix_input', 'check_config', 'refresh', 'narrow_scope', 'retry', 'contact_admin']);
const defaultActions: Partial<Record<string, NextAction>> = {
  CG_MODEL_CONTEXT_EXCEEDED: 'narrow_scope', CG_MODEL_OUTPUT_TOO_LARGE: 'narrow_scope',
  CG_MODEL_REFUSED: 'fix_input', CG_MODEL_INVALID_SELECTION: 'refresh', CG_MODEL_EXECUTOR_UNSAFE: 'check_config',
};
export function modelFailure(error: unknown): GraphError {
  const modelError = error instanceof GraphError && modelCodes.has(error.code) ? error : undefined;
  const code = modelError?.code ?? 'CG_MODEL_UNAVAILABLE';
  // Keep validated recovery guidance without forwarding arbitrary executor messages.
  const action = modelError?.nextAction;
  const nextAction = action !== undefined && modelActions.has(action) ? action : defaultActions[code] ?? 'retry';
  return new GraphError(code, 'match', code === 'CG_MODEL_EXECUTOR_UNSAFE' ? 'Model executor cannot provide the required isolation' : 'Model selection failed', nextAction);
}
export function validateSelection(value: unknown, candidates: ReadonlySet<string>, maximum: number): ModelSelection {
  const data = copyJSON(value, 'CG_MODEL_OUTPUT_INVALID', 'match') as Record<string, unknown>;
  if (bytes(data) > maximum) fail('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Model output exceeds maxModelOutputBytes', 'narrow_scope');
  if (!data || Array.isArray(data) || typeof data !== 'object' || !['selected', 'none', 'ambiguous', 'needs_context'].includes(data.decision as string)) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Invalid model selection object', 'retry');
  const allowed = data.decision === 'needs_context' ? ['decision', 'ids', 'reason', 'missingInformation'] : ['decision', 'ids', 'reason'];
  if (Object.keys(data).some(key => !allowed.includes(key)) || !Array.isArray(data.ids) || data.ids.some(id => typeof id !== 'string') || (data.reason !== undefined && typeof data.reason !== 'string')) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Invalid model selection fields', 'retry');
  if (data.decision === 'selected' && !data.ids.length || data.decision === 'none' && data.ids.length || data.decision === 'ambiguous' && (data.ids.length < 2 || typeof data.reason !== 'string' || !data.reason.trim())) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model decision and selection cardinality disagree', 'retry');
  if (data.decision === 'needs_context' && (typeof data.reason !== 'string' || !data.reason.trim() || !Array.isArray(data.missingInformation) || !data.missingInformation.length || data.missingInformation.some(item => typeof item !== 'string' || !item.trim()))) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'needs_context requires a reason and missing information', 'retry');
  if (new Set(data.ids).size !== data.ids.length || data.ids.some(id => !candidates.has(id))) fail('CG_MODEL_INVALID_SELECTION', 'match', 'Model selected duplicate or unavailable candidate IDs', 'refresh');
  return data as unknown as ModelSelection;
}
/** Normalize the strict, all-fields-required model wire to the public union. */
export function selectionFromWire(value: unknown, maximum = 65536): ModelSelection {
  const wire = copyJSON(value, 'CG_MODEL_OUTPUT_INVALID', 'match') as Record<string, unknown>;
  if (bytes(wire) > maximum) fail('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Model wire exceeds the output budget', 'narrow_scope');
  if (!wire || Array.isArray(wire) || typeof wire !== 'object' || Object.keys(wire).sort().join(',') !== 'decision,ids,missingInformation,reason' || !(wire.reason === null || typeof wire.reason === 'string') || !Array.isArray(wire.missingInformation) || wire.missingInformation.some(item => typeof item !== 'string')) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Invalid structured model wire', 'retry');
  if (wire.decision !== 'needs_context' && wire.missingInformation.length) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Unexpected missingInformation for model decision', 'retry');
  const selection = { decision: wire.decision, ids: wire.ids, ...(wire.reason === null ? {} : { reason: wire.reason }), ...(wire.decision === 'needs_context' ? { missingInformation: wire.missingInformation } : {}) };
  return validateSelection(selection, new Set(Array.isArray(wire.ids) ? wire.ids as string[] : []), maximum);
}
export const modelWireSchema = {
  type: 'object', additionalProperties: false, required: ['decision', 'ids', 'reason', 'missingInformation'],
  properties: { decision: { enum: ['selected', 'none', 'ambiguous', 'needs_context'] }, ids: { type: 'array', items: { type: 'string' } }, reason: { type: ['string', 'null'] }, missingInformation: { type: 'array', items: { type: 'string' } } },
};
