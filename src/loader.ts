import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { types } from 'node:util';
import { copyJSON, bytes, descriptors, digest, freezeJSON } from './json.js';
import { fail, GraphError } from './errors.js';
import { forwardKinds, ID, validateProvider } from './schema.js';
import { parseRange } from './applicability.js';
import type { CapabilityDetail, GraphLimits, ModelExecutor, OpenOptions, ProviderDefinition, ProviderSummary } from './types.js';

export interface SourceConfig { kind: 'file' | 'inline'; file?: string; definition?: ProviderDefinition; documentRoot?: string; documentRootReal?: string }
export interface LoadedProvider {
  summary: ProviderSummary; definition: ProviderDefinition; capabilities: CapabilityDetail[];
  documentRoot?: string; documentRootReal?: string; staticHash: string;
}
export const defaultLimits: Readonly<GraphLimits> = Object.freeze({ maxProviderBytes: 8 * 1024 ** 2, maxCatalogBytes: 8 * 1024 ** 2, maxResultBytes: 8 * 1024 ** 2, maxDocumentBytes: 1024 ** 2, maxInputBytes: 64 * 1024, maxContextBytes: 128 * 1024, maxModelCatalogBytes: 8 * 1024 ** 2, maxModelOutputBytes: 64 * 1024 });
export function parseOpen(options: OpenOptions): { sources: SourceConfig[]; allowed?: string[]; limits: GraphLimits; model?: ModelExecutor } {
  const d = descriptors(options, 'CG_CONFIG_INVALID', 'config');
  if (Object.keys(d).some(k => !['providers', 'allowedProviders', 'limits', 'model'].includes(k))) fail('CG_CONFIG_INVALID', 'config', 'Unknown open option', 'check_config');
  const providerSources: unknown = d.providers?.value;
  if (!Array.isArray(providerSources) || types.isProxy(providerSources) || Object.getPrototypeOf(providerSources) !== Array.prototype || Reflect.ownKeys(providerSources).length !== providerSources.length + 1) fail('CG_CONFIG_INVALID', 'config', 'providers must be an array', 'check_config');
  const limits = { ...defaultLimits };
  if (d.limits?.value !== undefined) {
    for (const [key, property] of Object.entries(descriptors(d.limits.value, 'CG_CONFIG_INVALID', 'config'))) {
      if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(property.value) || property.value <= 0) fail('CG_CONFIG_INVALID', 'config', 'Limits must be known positive safe integers', 'check_config');
      limits[key as keyof GraphLimits] = property.value;
    }
  }
  let allowed: string[] | undefined;
  if (d.allowedProviders?.value !== undefined) {
    const value = copyJSON(d.allowedProviders.value, 'CG_CONFIG_INVALID', 'config');
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !ID.test(id))) fail('CG_CONFIG_INVALID', 'config', 'allowedProviders must contain Provider IDs', 'check_config');
    allowed = [...new Set(value as string[])];
  }
  const sources: SourceConfig[] = [];
  for (let i = 0; i < providerSources.length; i++) {
    const property = Object.getOwnPropertyDescriptor(providerSources, String(i));
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) fail('CG_CONFIG_INVALID', 'config', 'Provider source accessors and holes are invalid', 'check_config');
    const source = descriptors(property.value, 'CG_CONFIG_INVALID', 'config');
    if (Object.keys(source).some(key => !['file', 'definition', 'documentRoot'].includes(key))) fail('CG_CONFIG_INVALID', 'config', 'Unknown Provider source option', 'check_config');
    const hasFile = source.file?.value !== undefined;
    const hasDefinition = source.definition?.value !== undefined;
    if (hasFile === hasDefinition) fail('CG_CONFIG_INVALID', 'config', 'Choose exactly one file or definition source', 'check_config');
    if (hasFile) {
      if (typeof source.file!.value !== 'string' || !source.file!.value.trim() || source.file!.value.includes('\0') || source.documentRoot?.value !== undefined) fail('CG_CONFIG_INVALID', 'config', 'File sources use their JSON directory as document root', 'check_config');
      const file = path.resolve(source.file!.value);
      sources.push({ kind: 'file', file, documentRoot: path.dirname(file) });
    } else {
      const root = source.documentRoot?.value;
      if (root !== undefined && (typeof root !== 'string' || !root.trim() || root.includes('\0'))) fail('CG_CONFIG_INVALID', 'config', 'documentRoot must be a nonempty path', 'check_config');
      const definition = copyJSON(source.definition!.value, 'CG_DEFINITION_INVALID', 'load') as ProviderDefinition;
      if (bytes(definition) > limits.maxProviderBytes) fail('CG_DEFINITION_INVALID', 'load', 'Provider exceeds maxProviderBytes', 'fix_input');
      sources.push({ kind: 'inline', definition: freezeJSON(definition), ...(root === undefined ? {} : { documentRoot: path.resolve(root) }) });
    }
  }
  const model = d.model?.value;
  if (model !== undefined && (!model || typeof model.id !== 'string' || !model.id.trim() || typeof model.select !== 'function')) fail('CG_CONFIG_INVALID', 'config', 'ModelExecutor must have an id and select method', 'check_config');
  return { sources, limits, ...(allowed === undefined ? {} : { allowed }), ...(model === undefined ? {} : { model }) };
}

/** A bounded handle read prevents stat/read races from bypassing the byte limit. */
export async function readBounded(file: string, maximum: number): Promise<Buffer> {
  // O_NONBLOCK keeps a named pipe from blocking open(); the fstat check below rejects it.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error('Not a regular file');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, maximum - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) {
        const after = await handle.stat({ bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('CG_DEFINITION_INVALID', 'load', 'Provider source changed during reading', 'retry');
        return Buffer.concat(chunks, total);
      }
      total += bytesRead;
      if (total > maximum) fail('CG_DEFINITION_INVALID', 'load', 'Provider exceeds maxProviderBytes', 'fix_input');
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
}
export function validDocumentPath(value: string): boolean {
  return Boolean(value.trim()) && !value.includes('\0') && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[a-z]:/i.test(value) && !value.split(/[\\/]/).includes('..');
}
function httpsUrl(value: string): boolean { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
export async function loadProvider(source: SourceConfig, maximum: number): Promise<LoadedProvider> {
  let definition: unknown;
  try { definition = source.kind === 'file' ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(source.file!, maximum))) : copyJSON(source.definition, 'CG_DEFINITION_INVALID', 'load'); }
  catch (error) { if (error instanceof GraphError) throw error; fail('CG_DEFINITION_INVALID', 'load', 'Cannot read a valid UTF-8 JSON Provider source', 'fix_input'); }
  if (!validateProvider(definition)) fail('CG_DEFINITION_INVALID', 'load', `Invalid Provider at ${validateProvider.errors?.[0]?.instancePath || '/'}`, 'fix_input');
  const ids = new Set<string>();
  const capabilities: CapabilityDetail[] = [];
  for (const c of definition.capabilities) {
    if (ids.has(c.id)) fail('CG_DEFINITION_INVALID', 'load', 'Duplicate capability ID in Provider', 'fix_input');
    ids.add(c.id);
    for (const condition of c.appliesTo?.all ?? []) if (condition.op === 'semverRange' && !parseRange(condition.range)) fail('CG_DEFINITION_INVALID', 'load', 'Unsupported stable SemVer range in appliesTo', 'fix_input');
    const documents = c.documents ?? [];
    const documentIds = new Set<string>();
    for (const document of documents) {
      if (documentIds.has(document.id)) fail('CG_DEFINITION_INVALID', 'load', 'Duplicate document ID in capability', 'fix_input');
      documentIds.add(document.id);
      if (document.source.type === 'file' ? !validDocumentPath(document.source.path) : !httpsUrl(document.source.url)) fail('CG_DEFINITION_INVALID', 'load', 'Invalid document reference path or HTTPS URL', 'fix_input');
    }
    if (c.usage?.contract && !httpsUrl(c.usage.contract.uri) && !/^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s]+$/i.test(c.usage.contract.uri)) fail('CG_DEFINITION_INVALID', 'load', 'Contract references require a valid HTTPS URL or URN', 'fix_input');
    capabilities.push({ id: `${definition.providerId}::${c.id}`, providerId: definition.providerId, name: c.name, description: c.description,
      ...(c.whenToUse === undefined ? {} : { whenToUse: c.whenToUse }), ...(c.usage === undefined ? {} : { usage: c.usage }), ...(c.appliesTo === undefined ? {} : { appliesTo: c.appliesTo }),
      relations: Object.fromEntries(forwardKinds.map(kind => [kind, [...new Set((c.relations?.[kind] ?? []).map(id => id.includes('::') ? id : `${definition.providerId}::${id}`))].sort()])) as CapabilityDetail['relations'], documents });
  }
  capabilities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const summary: ProviderSummary = { providerId: definition.providerId, name: definition.name, version: definition.version, capabilityCount: capabilities.length, ...(definition.description === undefined ? {} : { description: definition.description }) };
  if (source.documentRoot && !source.documentRootReal) {
    try { source.documentRootReal = await realpath(source.documentRoot); } catch { /* Missing/inaccessible document roots are diagnosed only when reading a body. */ }
  }
  return freezeJSON({ summary, definition, capabilities, ...(source.documentRoot === undefined ? {} : { documentRoot: source.documentRoot }), ...(source.documentRootReal === undefined ? {} : { documentRootReal: source.documentRootReal }), staticHash: digest({ summary, capabilities }) });
}
