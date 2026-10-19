#!/usr/bin/env node
import path from 'node:path';
import { CapabilityGraph } from '../graph.js';
import { GraphError, fail } from '../errors.js';
import { createMcpServer } from '../mcp/index.js';
import { createGraphTools } from '../tools/index.js';
import { readConfiguration } from './config.js';
import { fileURLToPath } from 'node:url';
import { maintain, type MaintenanceReport } from './maintenance.js';

const usage = `Capability Graph\n  validate --file PROVIDER.json\n  doctor --config CONFIG.json\n  serve --config CONFIG.json [--transport stdio|http]\n  setup --host codex --config /absolute/CONFIG.json [--dry-run] [--json]\n  doctor --host codex [--repair [--dry-run]] [--json]\n  clean --host codex [--dry-run] [--json]\n\nConfiguration paths resolve relative to CONFIG.json. Host registration requires explicit setup.\n`;
async function maintenance(args: string[]): Promise<void> {
  const command = args[0] as MaintenanceReport['command'], flags = new Map<string, string | boolean>(); let invalid = false;
  for (let i = 1; i < args.length; i++) {
    const key = args[i]!;
    if (flags.has(key)) { invalid = true; break; }
    if (['--dry-run', '--json', '--repair'].includes(key)) flags.set(key, true);
    else if (['--host', '--config'].includes(key) && args[i + 1] && !args[i + 1]!.startsWith('--')) flags.set(key, args[++i]!);
    else { invalid = true; break; }
  }
  invalid ||= flags.get('--host') !== 'codex' || command === 'setup' && !flags.has('--config') || command !== 'setup' && flags.has('--config') || command !== 'doctor' && flags.has('--repair') || command === 'doctor' && flags.has('--dry-run') && !flags.has('--repair');
  let result: { report: MaintenanceReport; exitCode: number };
  if (invalid) result = { exitCode: 2, report: { command, status: 'failed', changed: false, paths: [], warnings: [], checks: [{ name: 'arguments', status: 'fail', message: 'Invalid maintenance arguments. See --help.' }] } };
  else result = await maintain({ command, ...(flags.has('--config') ? { config: flags.get('--config') as string } : {}), dryRun: flags.has('--dry-run'), repair: flags.has('--repair'), cli: fileURLToPath(import.meta.url), skillSource: fileURLToPath(new URL('../../plugin/skills/capability-discovery/SKILL.md', import.meta.url)) });
  process.stdout.write(args.includes('--json') ? JSON.stringify(result.report) + '\n' : `${command}: ${result.report.status}; changed=${result.report.changed}\n` + result.report.checks.map(c => `${c.name}: ${c.message}\n`).join('') + result.report.warnings.map(w => `Notice: ${w}\n`).join(''));
  process.exitCode = result.exitCode;
}
async function main(args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(usage); return; }
  if (['setup', 'clean'].includes(args[0]!) || args[0] === 'doctor' && args.some(a => ['--host', '--repair', '--dry-run'].includes(a))) { await maintenance(args); return; }
  const command = args.shift(); const flags = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!, value = args.shift();
    if (!['--file', '--config', '--transport'].includes(key) || !value || value.startsWith('--') || flags.has(key)) fail('CG_INPUT_INVALID', 'config', 'Invalid or duplicate CLI argument', 'fix_input');
    flags.set(key, value);
  }
  if (command === 'validate') {
    if (!flags.has('--file') || flags.size !== 1) fail('CG_INPUT_INVALID', 'config', 'validate requires only --file', 'fix_input');
    const graph = await CapabilityGraph.open({ providers: [{ file: path.resolve(flags.get('--file')!) }] });
    try { process.stdout.write(JSON.stringify({ ok: true, ...(await graph.listProviders()) }) + '\n'); } finally { await graph.close(); }
    return;
  }
  if (!['doctor', 'serve'].includes(command ?? '') || !flags.has('--config') || flags.has('--file') || command === 'doctor' && flags.size !== 1) fail('CG_INPUT_INVALID', 'config', 'Choose validate, doctor or serve with explicit configuration', 'fix_input');
  const configuration = await readConfiguration(flags.get('--config')!);
  const override = flags.get('--transport');
  if (override !== undefined && override !== 'stdio' && override !== 'http') fail('CG_INPUT_INVALID', 'config', 'transport must be stdio or http', 'fix_input');
  const graph = await CapabilityGraph.open(configuration.graph);
  try {
    const options = { graph, transport: override ?? configuration.transport, enableMatch: configuration.enableMatch, ...(configuration.http ? { http: configuration.http } : {}) };
    const service = createMcpServer(options);
    if (command === 'doctor') {
      process.stdout.write(JSON.stringify({ ok: true, modelConfigured: Boolean(configuration.graph.model), modelVerification: 'not_run', toolCount: createGraphTools(graph, { enableMatch: configuration.enableMatch }).definitions.length, ...(await graph.listProviders()) }) + '\n');
      await service.close(); return;
    }
    const stop = () => { void service.close(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    try { const address = await service.start(); process.stderr.write(JSON.stringify({ ready: true, ...address }) + '\n'); await service.waitUntilClosed(); }
    finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); await service.close(); }
  } finally { await graph.close(); }
}
main(process.argv.slice(2)).catch(error => {
  const result = error instanceof GraphError ? error.toJSON() : { code: 'CG_CONFIG_INVALID', phase: 'config', message: 'CLI operation failed safely', nextAction: 'check_config' };
  process.stderr.write(JSON.stringify({ ok: false, error: result }) + '\n'); process.exitCode = 1;
});
