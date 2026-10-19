import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registration, replaceRegistration } from '../src/cli/registration.js';

const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
async function fixture(run: (f: { root: string; config: string; toml: string; skill: string; state: string; call: (...args: string[]) => { code: number | null; report: any; stdout: string } }) => Promise<void>) {
  const base = process.env.CG_TEST_DIR!; await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'host with spaces-')), config = path.join(root, 'graph.json');
  const toml = path.join(root, '.codex/config.toml'), skill = path.join(root, '.agents/skills/capability-discovery/SKILL.md'), state = path.join(root, '.capability-graph/registration.json');
  await writeFile(path.join(root, 'provider.json'), JSON.stringify({ providerId: 'demo', name: 'Demo', version: '1', capabilities: [{ id: 'one', name: 'One', description: 'One capability' }] }));
  await writeFile(config, JSON.stringify({ providers: [{ file: './provider.json' }], allowedProviders: ['demo'] }));
  const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, '.codex') };
  const call = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: path.dirname(root), env, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error); assert(result.stdout.trim(), result.stderr); return { code: result.status, report: JSON.parse(result.stdout), stdout: result.stdout };
  };
  try { await run({ root, config, toml, skill, state, call }); } finally { await rm(root, { recursive: true, force: true }); }
}
test('maintenance preview does not create home files or start an invalid Provider source', async () => fixture(async f => {
  await writeFile(f.config, JSON.stringify({ providers: [{ file: './missing.json' }] }));
  const preview = f.call('setup', '--host', 'codex', '--config', f.config, '--dry-run');
  assert.equal(preview.code, 0); assert.equal(preview.report.status, 'planned'); assert.equal(preview.report.changed, false);
  await assert.rejects(stat(path.dirname(f.state)), { code: 'ENOENT' }); await assert.rejects(stat(f.toml), { code: 'ENOENT' });
  const actual = f.call('setup', '--host', 'codex', '--config', f.config);
  assert.equal(actual.code, 1); await assert.rejects(stat(f.toml), { code: 'ENOENT' }); await assert.rejects(stat(f.skill), { code: 'ENOENT' });
}));
test('real setup, idempotent registration, diagnostic discovery, repair and owned cleanup preserve business and host content', async () => fixture(async f => {
  const original = '# keep this comment\nmodel="unrelated-model"\n[features]\nmcp_2026_07_28=true\n[mcp_servers.other]\ncommand="untouched"\n';
  await mkdir(path.dirname(f.toml), { recursive: true }); await writeFile(f.toml, original);
  const setup = f.call('setup', '--host', 'codex', '--config', f.config);
  assert.equal(setup.code, 0, setup.stdout); assert.equal(setup.report.changed, true);
  const installed = await readFile(f.toml, 'utf8'); assert(installed.includes(original)); assert.equal(registration(installed)?.text.match(/command = /g)?.length, 1);
  const state = JSON.parse(await readFile(f.state, 'utf8')); assert.equal(state.command, process.execPath); assert.equal(state.config, f.config); assert.equal(state.cli, cli); assert(!JSON.stringify(state).includes('unrelated-model'));
  assert.equal(f.call('setup', '--host', 'codex', '--config', f.config).report.changed, false);
  const reformattedState = JSON.stringify(state, null, 4); await writeFile(f.state, reformattedState);
  const doctor = f.call('doctor', '--host', 'codex'); assert.equal(doctor.code, 0, doctor.stdout); assert(doctor.report.checks.some((c: any) => c.message.includes('5 tools'))); assert.equal(await readFile(f.state, 'utf8'), reformattedState, 'read-only diagnosis must not normalize state');
  await rm(f.skill); assert.equal(f.call('doctor', '--host', 'codex').code, 3);
  const planned = f.call('doctor', '--host', 'codex', '--repair', '--dry-run'); assert.equal(planned.code, 0); await assert.rejects(stat(f.skill), { code: 'ENOENT' });
  assert.equal(f.call('doctor', '--host', 'codex', '--repair').code, 0); assert.equal(await readFile(f.skill, 'utf8'), state.skill);
  await writeFile(f.toml, replaceRegistration(await readFile(f.toml, 'utf8'))); assert.equal(f.call('doctor', '--host', 'codex', '--repair').code, 0);
  assert.equal(f.call('clean', '--host', 'codex', '--dry-run').report.changed, false); assert(await readFile(f.skill, 'utf8'));
  const clean = f.call('clean', '--host', 'codex'); assert.equal(clean.code, 0, clean.stdout); assert.equal(registration(await readFile(f.toml, 'utf8')), undefined); assert((await readFile(f.toml, 'utf8')).includes(original));
  await assert.rejects(stat(f.state), { code: 'ENOENT' }); await assert.rejects(stat(f.skill), { code: 'ENOENT' }); assert(await readFile(f.config, 'utf8'));
  assert.equal(f.call('clean', '--host', 'codex').report.changed, false);
}));
test('same-name unowned entry, modified owned table and modified Skill refuse takeover or deletion', async () => fixture(async f => {
  await mkdir(path.dirname(f.toml), { recursive: true }); const existing = '[mcp_servers.capability_graph]\ncommand="someone-else"\n'; await writeFile(f.toml, existing);
  assert.equal(f.call('setup', '--host', 'codex', '--config', f.config).code, 3); assert.equal(await readFile(f.toml, 'utf8'), existing);
  await rm(f.toml); assert.equal(f.call('setup', '--host', 'codex', '--config', f.config).code, 0);
  const original = await readFile(f.toml, 'utf8'); await writeFile(f.toml, original.replace('command = ', 'command  = '));
  assert.equal(f.call('clean', '--host', 'codex').code, 3); assert.equal(f.call('doctor', '--host', 'codex', '--repair').code, 3);
  await writeFile(f.toml, original); await writeFile(f.skill, 'user edit'); assert.equal(f.call('setup', '--host', 'codex', '--config', f.config).code, 3); assert.equal(await readFile(f.skill, 'utf8'), 'user edit');
}));
test('TOML layout protection covers inline, dotted, nested, array and malformed entries', () => {
  for (const text of ['mcp_servers={capability_graph={command="x"}}', 'mcp_servers.capability_graph.command="x"', '[mcp_servers]\ncapability_graph={command="x"}', '[mcp_servers.capability_graph.env]\nX="x"', '[[mcp_servers.capability_graph]]\ncommand="x"', 'broken = [']) assert.throws(() => registration(text));
  const source = '[mcp_servers.other]\ncommand="other"\n'; assert(replaceRegistration(source, '[mcp_servers.capability_graph]\ncommand="ours"').includes(source));
});
test('maintenance validates argument combinations and absolute JSON paths without changing old doctor', async () => fixture(async f => {
  for (const args of [['setup', '--host', 'other', '--config', f.config], ['setup', '--host', 'codex'], ['setup', '--host', 'codex', '--config', 'relative.json'], ['doctor', '--host', 'codex', '--dry-run'], ['clean', '--host', 'codex', '--repair'], ['doctor', '--host', 'codex', '--config', f.config], ['setup', '--host', 'codex', '--config', f.config, '--host', 'codex']]) assert.equal(f.call(...args).code, 2, args.join(' '));
  const old = spawnSync(process.execPath, [cli, 'doctor', '--config', f.config], { encoding: 'utf8' }); assert.equal(old.status, 0, old.stderr); assert.equal(JSON.parse(old.stdout).toolCount, 5); assert(!('command' in JSON.parse(old.stdout)));
}));
test('symbolic maintenance directories cannot redirect writes', async () => fixture(async f => {
  const target = path.join(f.root, 'elsewhere'); await mkdir(target); await symlink(target, path.join(f.root, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.call('setup', '--host', 'codex', '--config', f.config); assert.equal(result.code, 3); await assert.rejects(stat(path.join(target, 'config.toml')), { code: 'ENOENT' });
}));
test('interrupted owned transaction can recover without storing or overwriting unrelated TOML', async () => fixture(async f => {
  await mkdir(path.dirname(f.toml), { recursive: true }); const original = 'model="private-value-not-for-journal"\n'; await writeFile(f.toml, original);
  const faultyCli = path.join(f.root, 'faulty.mjs'), launcher = path.join(f.root, 'launch.mjs');
  await writeFile(faultyCli, `import {mkdir} from 'node:fs/promises';await mkdir(${JSON.stringify(f.state)},{recursive:true});await import(${JSON.stringify(new URL('../src/cli/main.js', import.meta.url).href)});`);
  await writeFile(launcher, `import {maintain} from ${JSON.stringify(new URL('../src/cli/maintenance.js', import.meta.url).href)};const x=await maintain({command:'setup',config:${JSON.stringify(f.config)},cli:${JSON.stringify(faultyCli)},skillSource:${JSON.stringify(path.join(process.cwd(), 'plugin/skills/capability-discovery/SKILL.md'))},dryRun:false,repair:false});console.log(JSON.stringify(x));`);
  const fail = spawnSync(process.execPath, [launcher], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: f.root, USERPROFILE: f.root, CODEX_HOME: path.dirname(f.toml) } }); assert.ifError(fail.error);
  const report = JSON.parse(fail.stdout); assert.equal(report.exitCode, 3, fail.stderr); assert.equal(registration(await readFile(f.toml, 'utf8')), undefined); assert((await readFile(f.toml, 'utf8')).includes(original));
  const journal = path.join(path.dirname(f.state), 'transaction.json'); assert(!(await readFile(journal, 'utf8')).includes('private-value-not-for-journal'));
  await rm(f.state, { recursive: true }); const recovered = f.call('clean', '--host', 'codex'); assert.equal(recovered.code, 0, recovered.stdout); await assert.rejects(stat(journal), { code: 'ENOENT' });
}));
test('recovery cannot smuggle unrelated TOML tables into an owned-entry rollback', async () => fixture(async f => {
  const original = '[mcp_servers.other]\ncommand="keep"\n'; await mkdir(path.dirname(f.toml), { recursive: true }); await writeFile(f.toml, original); await mkdir(path.dirname(f.state), { recursive: true });
  const injected = '[mcp_servers.capability_graph]\ncommand="old"\n[mcp_servers.other]\ncommand="replacement"';
  await writeFile(path.join(path.dirname(f.state), 'transaction.json'), JSON.stringify({ changes: [{ file: f.toml, table: true, before: injected, after: null }] }));
  const result = f.call('clean', '--host', 'codex'); assert.equal(result.code, 3); assert.equal(await readFile(f.toml, 'utf8'), original); await assert.rejects(stat(f.skill), { code: 'ENOENT' });
}));
