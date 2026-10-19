import path from 'node:path';
import { fail, GraphError } from '../errors.js';
import { copyJSON } from '../json.js';
import { createCodexExecutor } from '../adapters/codex.js';
import { createOpenAIExecutor } from '../adapters/openai.js';
import { readBounded } from '../loader.js';
import type { GraphLimits, OpenOptions, ProviderSource } from '../types.js';
import type { McpHttpOptions } from '../mcp/index.js';

export interface CliConfiguration { graph: OpenOptions; transport: 'stdio' | 'http'; enableMatch: boolean; http?: McpHttpOptions }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CG_CONFIG_INVALID', 'config', 'Expected a configuration object', 'check_config'); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) fail('CG_CONFIG_INVALID', 'config', 'Unknown configuration field', 'check_config'); }
function relative(base: string, value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('CG_CONFIG_INVALID', 'config', 'Expected a nonempty configuration path', 'check_config'); return path.resolve(base, value); }
function environment(name: unknown): string {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail('CG_CONFIG_INVALID', 'config', 'Expected an environment variable name', 'check_config');
  const value = process.env[name]; if (!value) fail('CG_CONFIG_INVALID', 'config', 'A configured credential environment variable is not set', 'check_config'); return value;
}
export async function readConfiguration(file: string): Promise<CliConfiguration> {
  const full = path.resolve(file), base = path.dirname(full); let data: Record<string, unknown>;
  try { const raw = await readBounded(full, 8 * 1024 ** 2); data = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); }
  catch { fail('CG_CONFIG_INVALID', 'config', 'Cannot read a valid bounded JSON configuration file', 'check_config'); }
  keys(data, ['schemaVersion', 'providers', 'allowedProviders', 'limits', 'model', 'transport', 'enableMatch', 'http']);
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1 || !Array.isArray(data.providers) || data.enableMatch !== undefined && typeof data.enableMatch !== 'boolean' || data.transport !== undefined && !['stdio', 'http'].includes(data.transport as string)) fail('CG_CONFIG_INVALID', 'config', 'Invalid CLI configuration', 'check_config');
  const providers: ProviderSource[] = data.providers.map(value => {
    const source = record(value); keys(source, ['file', 'definition', 'documentRoot']);
    if (source.file !== undefined) {
      if (source.definition !== undefined || source.documentRoot !== undefined) fail('CG_CONFIG_INVALID', 'config', 'File sources cannot also configure an inline definition or root', 'check_config');
      return { file: relative(base, source.file) };
    }
    if (source.definition === undefined) fail('CG_CONFIG_INVALID', 'config', 'Provider source requires file or definition', 'check_config');
    return { definition: source.definition as Extract<ProviderSource, { definition: unknown }>['definition'], ...(source.documentRoot === undefined ? {} : { documentRoot: relative(base, source.documentRoot) }) };
  });
  const graph: OpenOptions = { providers, ...(data.allowedProviders === undefined ? {} : { allowedProviders: data.allowedProviders as string[] }), ...(data.limits === undefined ? {} : { limits: data.limits as Partial<GraphLimits> }) };
  if (data.model !== undefined) {
    const model = record(data.model);
    if (model.type === 'openai') {
      keys(model, ['type', 'apiKeyEnv', 'model', 'baseURL', 'maxOutputBytes']);
      graph.model = createOpenAIExecutor({ apiKey: environment(model.apiKeyEnv), model: model.model as string, ...(model.baseURL === undefined ? {} : { baseURL: model.baseURL as string }), ...(model.maxOutputBytes === undefined ? {} : { maxOutputBytes: model.maxOutputBytes as number }) });
    } else if (model.type === 'codex') {
      keys(model, ['type', 'command', 'authHome', 'scratchRoot', 'runtimeRoot', 'model', 'maxOutputBytes']);
      graph.model = createCodexExecutor({ ...(model.command === undefined ? {} : { command: relative(base, model.command) }), ...(model.authHome === undefined ? {} : { authHome: relative(base, model.authHome) }), ...(model.scratchRoot === undefined ? {} : { scratchRoot: relative(base, model.scratchRoot) }), ...(model.runtimeRoot === undefined ? {} : { runtimeRoot: relative(base, model.runtimeRoot) }), ...(model.model === undefined ? {} : { model: model.model as string }), ...(model.maxOutputBytes === undefined ? {} : { maxOutputBytes: model.maxOutputBytes as number }) });
    } else fail('CG_CONFIG_INVALID', 'config', 'Unknown model adapter', 'check_config');
  }
  let http: McpHttpOptions | undefined;
  if (data.http !== undefined) {
    const raw = copyJSON(record(data.http), 'CG_CONFIG_INVALID', 'config');
    const { auth: inputAuth, ...rest } = raw; http = rest as McpHttpOptions;
    if (inputAuth !== undefined) {
      const auth = record(inputAuth);
      if (auth.type === 'none') { keys(auth, ['type']); http.auth = { type: 'none' }; }
      else if (auth.type === 'bearer') { keys(auth, ['type', 'tokenEnv']); http.auth = { type: 'bearer', token: environment(auth.tokenEnv) }; }
      else fail('CG_CONFIG_INVALID', 'config', 'Unknown HTTP authentication mode', 'check_config');
    }
  }
  return { graph, transport: (data.transport ?? 'stdio') as 'stdio' | 'http', enableMatch: data.enableMatch === true, ...(http ? { http } : {}) };
}
