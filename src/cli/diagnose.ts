import { Client, DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const required = ['list_providers', 'list_catalog', 'get_capabilities', 'resolve', 'read_document'].map(v => 'capability_graph_' + v);
export async function diagnose(command: string, args: string[]): Promise<number> {
  const transport = new StdioClientTransport({ command, args, stderr: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter((v): v is [string, string] => v[1] !== undefined)) });
  const client = new Client({ name: 'capability-graph-diagnostic', version: '2.1.1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Include cold Node/module loading using the SDK's standard request budget.
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP startup or tool discovery timed out.')), DEFAULT_REQUEST_TIMEOUT_MSEC); });
  const work = (async () => {
    transport.stderr?.on('data', () => {});
    await client.connect(transport);
    // Modern stdio connects before module startup; first discovery includes that cold start.
    const { tools } = await client.listTools({}, { timeout: DEFAULT_REQUEST_TIMEOUT_MSEC });
    const names = tools.map(t => t.name);
    if (required.some(n => !names.includes(n)) || names.some(n => !required.includes(n) && n !== 'capability_graph_match') || new Set(names).size !== names.length) throw new Error('MCP tools do not match the Graph contract.');
    return tools.length;
  })();
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer); await client.close(); await transport.close(); }
}
