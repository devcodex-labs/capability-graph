import { lstat, readFile, mkdir, open, rename, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readConfiguration } from './config.js';
import { diagnose } from './diagnose.js';
import { ProtectionConflict, registration, registrationBlock, replaceRegistration } from './registration.js';

export interface MaintenanceReport {
  command: 'setup' | 'doctor' | 'clean'; status: 'ok' | 'planned' | 'conflict' | 'failed'; changed: boolean;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'skipped'; message: string }>; paths: string[]; warnings: string[];
}
export interface MaintenanceOptions { command: MaintenanceReport['command']; config?: string; dryRun: boolean; repair: boolean; cli: string; skillSource: string }
interface RecordEntry { version: 1; configFile: string; skillFile: string; config: string; command: string; cli: string; block: string; skill: string }
interface Change { file: string; before: string | null; after: string | null }
interface JournalChange extends Change { table?: boolean; removeEmpty?: boolean }
const maximum = 8 * 1024 * 1024;
async function safe(file: string): Promise<void> {
  const full = path.resolve(file), root = path.parse(full).root; let part = root;
  for (const name of full.slice(root.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, name);
    try { if ((await lstat(part)).isSymbolicLink()) throw new ProtectionConflict('A maintenance path is a symbolic link; reconcile it manually.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
async function read(file: string): Promise<string | null> {
  await safe(file);
  try {
    const handle = await open(file, 'r');
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > maximum) throw new ProtectionConflict('A maintenance file is not a bounded regular file.'); return await handle.readFile('utf8'); }
    finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function write(change: Change): Promise<void> {
  if (await read(change.file) !== change.before) throw new ProtectionConflict('A file changed during maintenance; your edit was preserved.');
  if (change.after === null) { if (change.before !== null) await unlink(change.file); return; }
  await mkdir(path.dirname(change.file), { recursive: true }); await safe(change.file);
  const temp = path.join(path.dirname(change.file), '.capability-graph-' + randomUUID() + '.tmp');
  const mode = change.before === null ? 0o600 : (await lstat(change.file)).mode & 0o777;
  try {
    const handle = await open(temp, 'wx', mode);
    try { await handle.writeFile(change.after, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (await read(change.file) !== change.before) throw new ProtectionConflict('Concurrent edits were preserved.');
    await rename(temp, change.file);
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
function decode<T>(text: string): T { try { return JSON.parse(text) as T; } catch { throw new ProtectionConflict('Owned maintenance state is invalid; preserve it for recovery.'); } }
async function restore(change: JournalChange): Promise<void> {
  const current = await read(change.file);
  if (change.table) {
    const block = registration(current ?? '')?.text ?? null;
    if (block === change.before) return;
    if (block !== change.after) throw new ProtectionConflict('Recovery conflicts with an edited Graph table.');
    const reverted = replaceRegistration(current ?? '', change.before ?? undefined);
    await write({ file: change.file, before: current, after: change.removeEmpty && !reverted.trim() ? null : reverted });
  } else if (current === change.after) await write({ file: change.file, before: current, after: change.before });
  else if (current !== change.before) throw new ProtectionConflict('Recovery conflicts with user edits.');
}
export async function maintain(options: MaintenanceOptions): Promise<{ report: MaintenanceReport; exitCode: number }> {
  const report: MaintenanceReport = { command: options.command, status: 'failed', changed: false, checks: [], paths: [], warnings: [] };
  const check = (name: string, status: 'pass' | 'fail' | 'skipped', message: string) => report.checks.push({ name, status, message });
  let lock: string | undefined;
  let phase = 'ownership and paths';
  let transaction: { changes: JournalChange[]; journal: string; text: string } | undefined;
  try {
    const user = homedir(), codex = process.env.CODEX_HOME ?? path.join(user, '.codex');
    if (!path.isAbsolute(user) || !path.isAbsolute(codex)) throw new ProtectionConflict('User home and CODEX_HOME must be absolute.');
    const configFile = path.join(codex, 'config.toml'), skillFile = path.join(user, '.agents/skills/capability-discovery/SKILL.md');
    const stateDir = path.join(user, '.capability-graph'), stateFile = path.join(stateDir, 'registration.json'), journal = path.join(stateDir, 'transaction.json');
    report.paths = [configFile, skillFile, stateFile];
    const mutating = options.command !== 'doctor' || options.repair;
    if (mutating && !options.dryRun) {
      await safe(stateDir); await mkdir(stateDir, { recursive: true });
      const candidate = path.join(stateDir, 'maintenance.lock');
      try { await mkdir(candidate); lock = candidate; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ProtectionConflict('Another maintenance operation or interrupted lock exists; do not force-remove it.'); throw error; }
    } else {
      try { await lstat(path.join(stateDir, 'maintenance.lock')); throw new ProtectionConflict('Maintenance is active or interrupted.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const pending = await read(journal);
    if (pending !== null) {
      if (!mutating || options.dryRun) throw new ProtectionConflict('An interrupted transaction needs explicit maintenance recovery.');
      const data = decode<{ changes: JournalChange[] }>(pending);
      if (!Array.isArray(data.changes) || data.changes.some(c => ![configFile, skillFile, stateFile].includes(c.file) || Boolean(c.table) !== (c.file === configFile) || c.before !== null && typeof c.before !== 'string' || c.after !== null && typeof c.after !== 'string')) throw new ProtectionConflict('Recovery state is invalid.');
      for (const change of data.changes) if (change.table) {
        for (const value of [change.before, change.after]) if (value !== null && registration(value)?.text !== value) throw new ProtectionConflict('Recovery may only replace the owned Graph table.');
      }
      for (const c of [...data.changes].reverse()) await restore(c);
      await write({ file: journal, before: pending, after: null }); check('recovery', 'pass', 'Recovered an interrupted owned transaction.');
    }
    const state = await read(stateFile), owned = state === null ? undefined : decode<RecordEntry>(state);
    if (owned && (owned.version !== 1 || owned.configFile !== configFile || owned.skillFile !== skillFile || typeof owned.skill !== 'string' || !path.isAbsolute(owned.config ?? '') || !path.isAbsolute(owned.command ?? '') || !path.isAbsolute(owned.cli ?? '') || owned.block !== registrationBlock(owned.command, [owned.cli, 'serve', '--config', owned.config, '--transport', 'stdio']))) throw new ProtectionConflict('Owned registration does not match this user or its declared command.');
    const currentConfig = await read(configFile), currentSkill = await read(skillFile), table = registration(currentConfig ?? '');
    if (owned) {
      if (table && table.text !== owned.block || currentSkill !== null && currentSkill !== owned.skill) throw new ProtectionConflict('Your MCP entry or Skill was edited; it will not be overwritten.');
    } else if (table || options.command === 'setup' && currentSkill !== null) throw new ProtectionConflict('A same-name entry or Skill is not owned by Capability Graph.');
    const changes: Change[] = []; let next: RecordEntry | undefined = owned;
    if (options.command === 'setup') {
      phase = 'JSON configuration';
      if (!options.config || !path.isAbsolute(options.config) || path.extname(options.config).toLowerCase() !== '.json') { check('configuration', 'fail', 'Use an existing absolute graph.config.json path.'); return { report, exitCode: 2 }; }
      await readConfiguration(options.config);
      phase = 'installed CLI and Skill';
      const args = [options.cli, 'serve', '--config', options.config, '--transport', 'stdio'];
      const block = registrationBlock(process.execPath, args), skill = await readFile(options.skillSource, 'utf8');
      if (options.dryRun) check('startup', 'skipped', 'Preview does not start MCP or call models.');
      else { phase = 'MCP startup and tool discovery'; check('startup', 'pass', `Actual MCP startup and discovery: ${await diagnose(process.execPath, args)} tools; no model called.`); }
      next = { version: 1, configFile, skillFile, config: options.config, command: process.execPath, cli: options.cli, block, skill };
      const updated = replaceRegistration(currentConfig ?? '', block);
      if (updated !== currentConfig) changes.push({ file: configFile, before: currentConfig, after: updated });
      if (skill !== currentSkill) changes.push({ file: skillFile, before: currentSkill, after: skill });
    } else if (!owned) {
      if (options.command === 'clean') { check('ownership', 'pass', 'No owned registration to remove.'); report.status = options.dryRun ? 'planned' : 'ok'; return { report, exitCode: 0 }; }
      throw new ProtectionConflict('No owned registration exists; run explicit setup.');
    } else if (options.command === 'clean') {
      if (table) changes.push({ file: configFile, before: currentConfig, after: replaceRegistration(currentConfig!, undefined) });
      if (currentSkill !== null) changes.push({ file: skillFile, before: currentSkill, after: null });
      next = undefined;
    } else {
      if (!table || currentSkill === null) {
        if (!options.repair) throw new ProtectionConflict('Owned registration or Skill is missing; use doctor --host codex --repair.');
        if (!table) changes.push({ file: configFile, before: currentConfig, after: replaceRegistration(currentConfig ?? '', owned.block) });
        if (currentSkill === null) changes.push({ file: skillFile, before: null, after: owned.skill });
      }
      if (options.dryRun) check('startup', 'skipped', 'Preview does not start the registered service.');
      else { phase = 'registered MCP startup and discovery'; check('startup', 'pass', `Registered MCP discovery: ${await diagnose(owned.command, [owned.cli, 'serve', '--config', owned.config, '--transport', 'stdio'])} tools; no model called.`); }
    }
    if (options.command !== 'clean') report.warnings.push('stdio supports MCP 2026-07-28 and 2025-06-18. HTTP requires 2026-07-28. Reload the host after changes. Diagnosis does not verify a host model task.');
    const serialized = next ? JSON.stringify(next, null, 2) + '\n' : null;
    if (mutating && state !== serialized) changes.push({ file: stateFile, before: state, after: serialized });
    check('ownership', 'pass', 'Only owned, unchanged entries and Skill are managed; business files remain caller-owned.');
    if (options.dryRun) {
      for (const change of changes) check('planned_write', 'skipped', `${change.after === null ? 'Remove' : change.before === null ? 'Create' : 'Update'}: ${change.file}`);
      check('write', 'skipped', `Planned ${changes.length} file changes; nothing written.`); report.status = 'planned'; return { report, exitCode: 0 };
    }
    if (changes.length) {
      phase = 'owned file transaction';
      // Persist only the owned TOML table, never unrelated host configuration.
      const recovery: JournalChange[] = changes.map(c => c.file === configFile ? { file: c.file, table: true, removeEmpty: c.before === null, before: registration(c.before ?? '')?.text ?? null, after: registration(c.after ?? '')?.text ?? null } : c);
      const text = JSON.stringify({ changes: recovery }) + '\n'; await write({ file: journal, before: null, after: text }); transaction = { changes: recovery, journal, text };
      for (const change of changes) await write(change);
      await write({ file: journal, before: text, after: null }); transaction = undefined; report.changed = true;
    }
    report.status = 'ok'; return { report, exitCode: 0 };
  } catch (error) {
    if (transaction) {
      let recovered = true;
      for (const c of [...transaction.changes].reverse()) {
        try { await restore(c); }
        catch { recovered = false; }
      }
      if (recovered) await write({ file: transaction.journal, before: transaction.text, after: null }).catch(() => {});
      else { report.changed = true; report.warnings.push('Recovery journal retained; concurrent edits were preserved. Review before retrying.'); }
    }
    report.status = error instanceof ProtectionConflict ? 'conflict' : 'failed';
    check('maintenance', 'fail', error instanceof ProtectionConflict ? error.message : `Maintenance failed during ${phase}. Check paths, JSON, permissions and MCP 2026-07-28 support.`);
    return { report, exitCode: report.status === 'conflict' ? 3 : 1 };
  } finally { if (lock) await rmdir(lock).catch(() => {}); }
}
