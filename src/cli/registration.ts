import { parseForESLint } from 'toml-eslint-parser';

export class ProtectionConflict extends Error {}
type Node = { type: string; range: [number, number]; resolvedKey?: string[]; key?: { keys: Array<{ name?: string; value?: string }> }; body?: Node[] };
const target = ['mcp_servers', 'capability_graph'];
export function registrationBlock(command: string, args: string[]): string {
  return `[mcp_servers.capability_graph]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}`;
}
/** Locate only a standalone table; never reinterpret inline/dotted ownership. */
export function registration(text: string): { start: number; end: number; text: string } | undefined {
  let nodes: Node[];
  try { nodes = parseForESLint(text).ast.body[0]!.body as unknown as Node[]; }
  catch { throw new ProtectionConflict('Codex TOML is invalid; preserve and correct it before maintenance.'); }
  let found: { start: number; end: number; text: string } | undefined;
  for (const node of nodes) {
    if (node.type === 'TOMLKeyValue') {
      const keys = node.key!.keys.map(k => k.name ?? k.value);
      if (keys[0] === 'mcp_servers' && (keys.length === 1 || keys[1] === target[1])) throw new ProtectionConflict('The Graph entry uses an unsupported inline or dotted TOML layout.');
    } else {
      const keys = node.resolvedKey ?? [];
      if (keys[0] !== target[0]) continue;
      if (keys.length === 1 && node.body?.some(v => (v.key?.keys[0]?.name ?? v.key?.keys[0]?.value) === target[1])) throw new ProtectionConflict('The Graph entry uses an inline TOML table.');
      if (keys[1] !== target[1]) continue;
      if (keys.length !== 2 || node.type !== 'TOMLTable' || found) throw new ProtectionConflict('Nested or array Graph tables need manual reconciliation.');
      found = { start: node.range[0], end: node.range[1], text: text.slice(...node.range) };
    }
  }
  return found;
}
export function replaceRegistration(text: string, block?: string): string {
  const current = registration(text);
  const result = current ? text.slice(0, current.start) + (block ?? '') + text.slice(current.end)
    : block ? text + (text && !text.endsWith('\n') ? '\n' : '') + '\n' + block + '\n' : text;
  registration(result);
  return result;
}
