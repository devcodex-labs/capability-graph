import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');

// Read a bounded parent chain to distinguish an explicitly requested global package from a hoisted dependency.
async function ancestors() {
  if (process.platform === 'win32') {
    const script = `$next=${process.ppid}; $rows=@(); for($i=0;$i -lt 5;$i++){ $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$next); if(!$p){break}; $rows += [pscustomobject]@{pid=$p.ProcessId;command=$p.CommandLine;started=[string]$p.CreationDate}; $next=$p.ParentProcessId }; ConvertTo-Json -InputObject $rows -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
    return JSON.parse(stdout).map(record => ({ ...record, args: [...String(record.command).matchAll(/"([^"]*)"|([^\s"]+)/g)].map(match => match[1] ?? match[2]) }));
  }
  const result = []; let pid = process.ppid;
  for (let index = 0; index < 5 && pid > 1; index++) {
    const [command, status, timing] = await Promise.all([readFile(`/proc/${pid}/cmdline`, 'utf8'), readFile(`/proc/${pid}/status`, 'utf8'), readFile(`/proc/${pid}/stat`, 'utf8')]);
    result.push({ pid, started: timing.slice(timing.lastIndexOf(')') + 2).split(' ')[19],
      executable: await realpath(`/proc/${pid}/exe`), args: command.split('\0').filter(Boolean) });
    pid = Number(status.match(/^PPid:\s*(\d+)/m)?.[1] ?? 0);
  }
  return result;
}
async function isDirectArgument(argument, root, metadata) {
  if (/^@devcodex\/capability-graph(?:@[^\s/\\]+)?$/.test(argument)) return true;
  if (argument.startsWith('-') || /^(?:https?:|git\+|npm:)/.test(argument)) return false;
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), argument.replace(/^file:/, ''));
  try {
    if (await realpath(file) === root) return true;
    const entry = await stat(file); if (!entry.isFile() || entry.size > 64 * 1024 * 1024) return false;
    const tar = gunzipSync(await readFile(file), { maxOutputLength: 32 * 1024 * 1024 });
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512), name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
      const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
      if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) return false;
      if (name === 'package/package.json') { const value = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString()); return value.name === metadata.name && value.version === metadata.version; }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } catch { return false; }
  return false;
}

/** A lifecycle/global flag or a direct install path alone never grants automatic registration. */
export async function inspectInstallContext() {
  if (process.env.npm_lifecycle_event !== 'postinstall' || process.env.npm_command !== 'install' || process.env.npm_config_global !== 'true')
    return { eligible: false, reason: '仅正常npm直接全局install执行自动接入；本地、依赖、手动脚本或import不注册。' };
  try {
    const prefix = process.env.npm_config_prefix; if (!prefix) return { eligible: false, reason: '无法证明全局prefix。' };
    const expected = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', '@devcodex', 'capability-graph');
    const root = await realpath(packageRoot); if (root !== await realpath(expected)) return { eligible: false, reason: '当前包不在prefix直接安装位置。' };
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    for (const parent of await ancestors()) {
      // npm 10/11 sets process.title to "npm <command> <remain>". Linux then replaces
      // /proc/cmdline, losing npm-cli.js and option flags. Require its actual Node image,
      // exact single install target, lifecycle/global flags and direct-prefix identity.
      if (process.platform === 'linux' && parent.args.length === 1 && process.env.npm_node_execpath &&
          parent.executable === await realpath(process.env.npm_node_execpath)) {
        const title = parent.args[0].match(/^npm (?:install|i|add) (.+)$/);
        if (title && await isDirectArgument(title[1], root, metadata)) return { eligible: true,
          reason: '直接prefix、npm生命周期、实际Node父进程与npm安装标题的精确目标一致。',
          authorityDigest: hash(JSON.stringify({ pid: parent.pid, started: parent.started, root, name: metadata.name, version: metadata.version })) };
      }
      const npm = parent.args.findIndex(argument => /(?:^|[/\\])npm-cli\.js$/.test(argument));
      if (npm === -1) continue;
      const action = parent.args.findIndex((argument, index) => index > npm && ['install', 'i', 'add'].includes(argument));
      if (action === -1 || !parent.args.some(argument => ['-g', '--global'].includes(argument))) continue;
      for (const argument of parent.args.slice(action + 1)) if (await isDirectArgument(argument, root, metadata))
        return { eligible: true, reason: '直接安装位置和npm父进程的显式安装目标一致。', authorityDigest: hash(JSON.stringify({ pid: parent.pid, started: parent.started, root, name: metadata.name, version: metadata.version })) };
    }
    return { eligible: false, reason: '无法证明直接安装目标，可能为hoisted依赖；运行capability-graph codex register显式接入。' };
  } catch { return { eligible: false, reason: '直接安装证据不可读取；运行capability-graph codex register显式接入。' }; }
}

/** Registration failures preserve the CLI when a durable failure result can be saved. */
export async function postinstall() {
  const context = await inspectInstallContext();
  if (!context.eligible) { process.stderr.write(`Capability Graph自动接入：not_run。${context.reason}\n`); return 0; }
  const { configPath, loadConfig, saveConfig, readText, replaceText, withFileLock, digest } = await import('../dist/cli/config.js');
  const { registerCodex } = await import('../dist/cli/codex-registration.js');
  const { diagnose } = await import('../dist/cli/doctor.js');
  const file = configPath(), resultFile = path.join(path.dirname(file), 'install-result.json');
  let result;
  try {
    const previous = await readText(resultFile);
    if (previous && JSON.parse(previous).authorityDigest === context.authorityDigest) { process.stderr.write('Capability Graph自动接入：not_run。同一次安装已处理，避免重入。\n'); return 0; }
    const loaded = await loadConfig(file, true); if (loaded.originalDigest === null) await saveConfig(file, loaded.config, null);
    await registerCodex(file); result = await diagnose(file, { probe: true });
  } catch (error) {
    result = { installed: { state: 'pass', evidence: packageRoot }, configRegistered: { state: 'fail', reason: error instanceof Error ? error.message : String(error), nextAction: 'capability-graph codex register' },
      localProtocolVerified: { state: 'not_run' }, clientConnected: { state: 'unknown' }, configPath: file, packageVersion: '2.0.0', checkedAt: new Date().toISOString(), diagnosticScope: 'install-attempt' };
  }
  result = { ...result, authorityDigest: context.authorityDigest, installContext: { eligible: true, reason: context.reason } };
  try {
    await withFileLock(resultFile, async () => { const before = await readText(resultFile); await replaceText(resultFile, JSON.stringify(result, null, 2) + '\n', before === undefined ? null : digest(before)); });
  } catch (error) { process.stderr.write(`Capability Graph安装结果无法持久保存：${String(error)}。npm可能撤销安装；修复目录权限后重试。\n`); return 1; }
  process.stderr.write(`Capability Graph：installed=${result.installed.state}，configRegistered=${result.configRegistered.state}，localProtocolVerified=${result.localProtocolVerified.state}，clientConnected=${result.clientConnected.state}。结果：${resultFile}。修复：capability-graph doctor --json。\n`);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await postinstall();
