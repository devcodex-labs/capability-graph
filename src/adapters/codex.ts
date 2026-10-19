import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { GraphError, fail } from '../errors.js';
import { modelWireSchema, selectionFromWire, validateSelection } from '../model.js';
import { selectionInput, selectionInstructions } from './prompt.js';
import type { ModelExecutor } from '../types.js';

export interface CodexExecutorOptions {
  /** Official native CLI executable; the verified target is 0.163.0. */
  command?: string;
  authHome?: string;
  scratchRoot?: string;
  /** Read-only installation resources, excluding business files and credentials. */
  runtimeRoot?: string;
  model?: string;
  maxOutputBytes?: number;
}
interface ProcessResult { code: number | null; stdout: string; stderr: string }
async function executable(command: string): Promise<string> {
  const candidates = command.includes(path.sep) ? [path.resolve(command)] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.resolve(dir, command));
  for (const candidate of candidates) try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* Continue PATH lookup. */ }
  fail('CG_MODEL_UNAVAILABLE', 'match', 'Codex CLI executable was not found', 'check_config');
}
function beneath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function aborted(signal: AbortSignal): GraphError {
  return signal.reason instanceof GraphError ? signal.reason : new GraphError('CG_MODEL_CANCELLED', 'match', 'Codex selection cancelled', 'retry');
}
function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal, input: string | undefined, maximum: number, deadline: number): Promise<ProcessResult> {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let outSize = 0, errSize = 0;
    let terminal: GraphError | undefined; let killTimer: NodeJS.Timeout | undefined;
    const stop = (error: GraphError) => {
      if (terminal) return; terminal = error;
      if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      killTimer = setTimeout(() => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 2000);
    };
    const onAbort = () => stop(aborted(signal));
    signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort();
    const timer = setTimeout(() => stop(new GraphError('CG_MODEL_TIMEOUT', 'match', 'Codex process deadline exceeded', 'retry')), deadline);
    child.stdout.on('data', (chunk: Buffer) => { outSize += chunk.length; if (outSize > maximum) stop(new GraphError('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Codex protocol output exceeded its transport budget', 'narrow_scope')); else stdout.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { errSize += chunk.length; if (errSize > 16384) stop(new GraphError('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Codex diagnostics exceeded their transport budget', 'check_config')); else stderr.push(chunk); });
    child.stdin.on('error', () => { /* Expected if a terminated child closes stdin. */ });
    child.on('error', () => { terminal ??= new GraphError('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'Required Codex isolation runtime could not start', 'check_config'); });
    child.on('close', code => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', onAbort);
      if (terminal) reject(terminal); else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

export function createCodexExecutor(options: CodexExecutorOptions = {}): ModelExecutor {
  const maximum = options.maxOutputBytes ?? 65536;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || options.model !== undefined && (typeof options.model !== 'string' || !options.model.trim())) fail('CG_CONFIG_INVALID', 'config', 'Invalid Codex output budget or model', 'check_config');
  const settings = { ...options };
  return {
    id: `codex-cli:${settings.model ?? 'default'}`,
    async select(request) {
      try {
      if (process.platform !== 'linux') fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'This adapter currently verifies Linux bubblewrap isolation only', 'check_config');
      if (request.signal.aborted) throw aborted(request.signal);
      const command = await executable(settings.command ?? 'codex');
      let authHome: string; let runtime: string;
      try {
        authHome = await realpath(settings.authHome ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex'));
        if (!(await stat(path.join(authHome, 'auth.json'))).isFile()) throw new Error();
        runtime = await realpath(settings.runtimeRoot ?? path.dirname(command));
      } catch { fail('CG_MODEL_UNAVAILABLE', 'match', 'Codex needs a CLI installation and dedicated login cache', 'check_config'); }
      if (!beneath(runtime, command) || beneath(runtime, authHome) || runtime === path.parse(runtime).root) fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'CLI runtime mounts must exclude credential stores', 'check_config');
      const scratch = path.resolve(settings.scratchRoot ?? path.join(process.env.CG_ARTIFACTS_DIR ?? tmpdir(), 'capability-graph-codex'));
      await mkdir(scratch, { recursive: true, mode: 0o700 }); const scratchReal = await realpath(scratch);
      if (beneath(runtime, scratchReal) || beneath(scratchReal, runtime) || beneath(scratchReal, authHome)) fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'Codex scratch, credentials and runtime need separate roots', 'check_config');
      const root = await mkdtemp(path.join(scratchReal, 'select-'));
      try {
        const home = path.join(root, 'home'), work = path.join(root, 'work'), temporary = path.join(root, 'tmp');
        await Promise.all([mkdir(path.join(home, '.codex'), { recursive: true, mode: 0o700 }), mkdir(work, { mode: 0o700 }), mkdir(temporary, { mode: 0o700 })]);
        const schema = path.join(temporary, 'selection.schema.json'); await writeFile(schema, JSON.stringify(modelWireSchema), { mode: 0o600 });
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: home, CODEX_HOME: path.join(home, '.codex'), TMPDIR: temporary, LANG: 'C.UTF-8' };
        for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT', 'CODEX_EXEC_SERVER_PROXY_PRIVATE_IPS_VIA_UPSTREAM']) if (process.env[key]) env[key] = process.env[key];
        const mounts = ['--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
        for (const system of ['/usr', '/bin', '/lib', '/lib64', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd']) try { await stat(system); mounts.push('--ro-bind', system, system); } catch { /* Optional platform path. */ }
        for (const key of ['NODE_EXTRA_CA_CERTS', 'CODEX_PROXY_CERT']) {
          const file = env[key]; if (file) try { if ((await stat(file)).isFile()) mounts.push('--ro-bind', file, file); } catch { /* TLS still enforces trust. */ }
        }
        mounts.push('--ro-bind', runtime, runtime, '--bind', home, home, '--bind', temporary, temporary, '--ro-bind', work, work, '--ro-bind', path.join(authHome, 'auth.json'), path.join(home, '.codex/auth.json'), '--chdir', work, '--', command);
        let probe: ProcessResult;
        try { probe = await run('/usr/bin/bwrap', [...mounts, '--version'], env, work, request.signal, undefined, 4096, 10000); }
        catch (error) { if (request.signal.aborted) throw aborted(request.signal); if (error instanceof GraphError && error.code === 'CG_MODEL_EXECUTOR_UNSAFE') throw error; fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'Codex filesystem isolation could not be verified', 'check_config'); }
        if (probe.code !== 0 || probe.stdout.trim() !== 'codex-cli 0.163.0') fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'Codex requires verified CLI 0.163.0 and working bubblewrap isolation', 'check_config');
        const args = [...mounts, '-c', 'approval_policy="never"', '-c', 'web_search="disabled"'];
        for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'computer_use', 'code_mode', 'artifact', 'sleep_tool']) args.push('-c', `features.${feature}=false`);
        args.push('exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--json', '--output-schema', schema, '--cd', work);
        if (settings.model) args.push('--model', settings.model);
        args.push('-');
        const result = await run('/usr/bin/bwrap', args, env, work, request.signal, selectionInstructions + '\nUntrusted selection data:\n' + selectionInput(request), Math.max(262144, maximum * 8), 600000);
        if (request.signal.aborted) throw aborted(request.signal);
        if (result.code !== 0) fail('CG_MODEL_UNAVAILABLE', 'match', 'Codex request failed; check CLI account access and configuration', 'check_config');
        let finalText: string | undefined;
        for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
          let event: { type?: string; item?: { type?: string; text?: string } };
          try { event = JSON.parse(line); } catch { fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Codex emitted invalid protocol JSON', 'retry'); }
          if (event.type === 'error' || event.type === 'turn.failed') fail('CG_MODEL_UNAVAILABLE', 'match', 'Codex turn failed', 'retry');
          if (event.item && !['agent_message', 'reasoning'].includes(event.item.type ?? '')) fail('CG_MODEL_EXECUTOR_UNSAFE', 'match', 'Codex attempted a disallowed operation', 'check_config');
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalText = event.item.text;
        }
        if (!finalText) fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Codex did not return a final selection', 'retry');
        if (Buffer.byteLength(finalText, 'utf8') > maximum) fail('CG_MODEL_OUTPUT_TOO_LARGE', 'match', 'Codex selection exceeds its byte budget', 'narrow_scope');
        let wire: unknown; try { wire = JSON.parse(finalText); } catch { fail('CG_MODEL_OUTPUT_INVALID', 'match', 'Codex final response is not selection JSON', 'retry'); }
        return validateSelection(selectionFromWire(wire, maximum), new Set(request.catalog.map(entry => entry.id)), maximum);
      } finally { await rm(root, { recursive: true, force: true }); }
      } catch (error) {
        if (error instanceof GraphError) throw error;
        fail('CG_MODEL_UNAVAILABLE', 'match', 'Codex runtime could not complete safely', 'check_config');
      }
    },
  };
}
