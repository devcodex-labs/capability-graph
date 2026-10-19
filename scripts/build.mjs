import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = process.argv.includes('--tests');
const output = path.resolve(process.env.CG_BUILD_DIR ?? path.join(root, 'dist'));
if (output === root || root.startsWith(output + path.sep)) throw new Error('Build output must not contain source');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', tests ? 'tsconfig.test.json' : 'tsconfig.json', '--outDir', output], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status === 0) {
  if (tests) fs.cpSync(path.join(root, 'plugin'), path.join(output, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
  const cli = path.join(output, tests ? 'src/cli/main.js' : 'cli/main.js');
  if (fs.existsSync(cli)) fs.chmodSync(cli, 0o755);
  const dependencies = path.join(output, 'node_modules');
  if (output !== path.join(root, 'dist') && !fs.existsSync(dependencies)) fs.symlinkSync(path.join(root, 'node_modules'), dependencies, process.platform === 'win32' ? 'junction' : 'dir');
}
process.exitCode = result.status ?? 1;
