import { fetch as proxyFetch, ProxyAgent } from 'undici';
import { GraphError, fail } from '../errors.js';
import { modelWireSchema, selectionFromWire, validateSelection } from '../model.js';
import { selectionInput, selectionInstructions } from './prompt.js';
import type { ModelExecutor } from '../types.js';

export interface OpenAIExecutorOptions {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxOutputBytes?: number;
  /** Trusted transport override; useful for a managed gateway or controlled tests. */
  fetch?: typeof globalThis.fetch;
}
export function createOpenAIExecutor(options: OpenAIExecutorOptions): ModelExecutor {
  if (!options || typeof options.apiKey !== 'string' || !options.apiKey.trim() || typeof options.model !== 'string' || !options.model.trim()) fail('CG_CONFIG_INVALID', 'config', 'OpenAI requires an explicit API key and model', 'check_config');
  const maximum = options.maxOutputBytes ?? 65536;
  if (!Number.isSafeInteger(maximum) || maximum < 1) fail('CG_CONFIG_INVALID', 'config', 'maxOutputBytes must be a positive safe integer', 'check_config');
  if (options.baseURL !== undefined) {
    try { if (new URL(options.baseURL).protocol !== 'https:') throw new Error(); }
    catch { fail('CG_CONFIG_INVALID', 'config', 'OpenAI baseURL must use HTTPS', 'check_config'); }
  }
  // Capture trusted configuration; no project scan, environment credential discovery or hidden retries.
  const { apiKey, model, baseURL, fetch: customFetch } = options;
  return {
    id: `openai:${model}`,
    async select(request) {
      if (request.signal.aborted) fail('CG_MODEL_CANCELLED', 'match', 'Model request cancelled', 'retry');
      let OpenAI: typeof import('openai').default;
      try { OpenAI = (await import('openai')).default; }
      catch { fail('CG_MODEL_UNAVAILABLE', 'match', 'Install the optional openai package to use this adapter', 'check_config'); }
      if (request.signal.aborted) fail('CG_MODEL_CANCELLED', 'match', 'Model request cancelled', 'retry');
      const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
      let agent: ProxyAgent | undefined;
      try { agent = !customFetch && proxy ? new ProxyAgent(proxy) : undefined; }
      catch { fail('CG_MODEL_UNAVAILABLE', 'match', 'Invalid proxy transport configuration', 'check_config'); }
      const transport: typeof globalThis.fetch = customFetch ?? ((input, init) => proxyFetch(input.toString(), { ...init, ...(agent ? { dispatcher: agent } : {}) } as Parameters<typeof proxyFetch>[1]) as unknown as Promise<Response>);
      const boundedFetch: typeof globalThis.fetch = async (input, init) => {
        const response = await transport(input, init); const reader = response.body?.getReader();
        if (!reader) return response;
        let count = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) { controller.close(); return; }
              count += value.byteLength;
              if (count > Math.max(262144, maximum * 8)) { await reader.cancel(); throw new GraphError('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Model response envelope exceeds its transport budget', 'narrow_scope'); }
              controller.enqueue(value);
            } catch (error) { controller.error(error); }
          },
          cancel(reason) { return reader.cancel(reason); },
        });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
      try {
        const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), fetch: boundedFetch, maxRetries: 0, logLevel: 'off' });
        const response = await client.responses.create({ model, instructions: selectionInstructions, input: selectionInput(request), store: false, text: { format: { type: 'json_schema', name: 'capability_selection', strict: true, schema: modelWireSchema } } }, { signal: request.signal });
        // A parsable selection is not final when generation failed or is still running.
        if (response?.status === 'failed') fail('CG_MODEL_UNAVAILABLE', 'match', 'Model response generation failed', 'retry');
        if (response?.status === 'cancelled') fail('CG_MODEL_CANCELLED', 'match', 'Model response generation was cancelled', 'retry');
        if (!response || response.status !== 'completed' || response.error !== null) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model response must be completed without an error', 'retry');
        if (!Array.isArray(response.output) || response.output.some(item => !item || typeof item !== 'object' || Array.isArray(item) || item.type === 'message' && !Array.isArray(item.content))) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model response has an invalid output envelope', 'retry');
        const content = response.output.filter(item => item.type === 'message').flatMap(item => item.content);
        if (content.some(part => !part || typeof part !== 'object' || Array.isArray(part) || (part.type === 'output_text' ? typeof part.text !== 'string' : part.type === 'refusal' ? typeof part.refusal !== 'string' : true))) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model response has invalid message content', 'retry');
        if (content.some(part => part.type === 'refusal')) fail('CG_MODEL_REFUSED', 'match', 'Model refused the selection request', 'fix_input');
        const text = content.filter(part => part.type === 'output_text').map(part => part.text).join('');
        if (Buffer.byteLength(text, 'utf8') > maximum) fail('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Model output exceeds its byte budget', 'narrow_scope');
        let wire: unknown;
        try { wire = JSON.parse(text); } catch { fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model did not return valid selection JSON', 'retry'); }
        const selection = selectionFromWire(wire, maximum);
        return validateSelection(selection, new Set(request.catalog.map(entry => entry.id)), maximum);
      } catch (error) {
        if (error instanceof GraphError) throw error;
        if (request.signal.aborted) throw request.signal.reason instanceof GraphError ? request.signal.reason : new GraphError('CG_MODEL_CANCELLED', 'match', 'Model request cancelled', 'retry');
        // The SDK decorates output before returning it; malformed content can fail there first.
        if (error instanceof TypeError) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Model response could not be decoded', 'retry');
        const details = error as { code?: string; name?: string; cause?: unknown };
        if (details.cause instanceof GraphError) throw details.cause;
        if (details.code === 'context_length_exceeded' || details.code === 'context_window_exceeded') fail('CG_MODEL_CONTEXT_EXCEEDED', 'match', 'Model context limit exceeded', 'narrow_scope');
        if (details.name === 'APIConnectionTimeoutError') fail('CG_MODEL_TIMEOUT', 'match', 'Model request timed out', 'retry');
        fail('CG_MODEL_UNAVAILABLE', 'match', 'OpenAI request failed; check API access and configuration', 'check_config');
      } finally { await agent?.destroy(); }
    },
  };
}
