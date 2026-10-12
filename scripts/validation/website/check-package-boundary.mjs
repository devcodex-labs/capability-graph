import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from '../../lib/artifact-paths.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const npm = process.env.npm_execpath;
assert(npm, 'run this check through npm');
const runNpm = (args) => execFileSync(process.execPath, [npm, ...args], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  timeout: 180_000,
  maxBuffer: 8 * 1024 * 1024
});

const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
assert(manifest.name === '@devcodex/capability-graph', 'unexpected package name');
assert(JSON.stringify(manifest.dependencies) === JSON.stringify({ '@modelcontextprotocol/server': '2.0.0',
  '@modelcontextprotocol/node': '2.0.0', '@modelcontextprotocol/client': '2.0.0', ajv: '8.17.1',
  'toml-eslint-parser': '0.10.1', 'bcp-47': '2.1.1', 'language-subtag-registry': '0.4.2' }),
  'public package dependencies must match the confirmed MCP/CLI/Core versions');
const [dryRun] = JSON.parse(runNpm(['pack', '--dry-run', '--json', '--ignore-scripts']));
const paths = dryRun.files.map(({ path: file }) => file);
assert(paths.includes('dist/index.js') && paths.includes('dist/index.d.ts'), 'tarball is missing public entry files');
assert(paths.every((file) => ['package.json', 'README.md', 'LICENSE', 'scripts/postinstall.mjs'].includes(file) || file.startsWith('dist/')),
  `tarball includes an unexpected file: ${paths.find((file) => !['package.json', 'README.md', 'LICENSE', 'scripts/postinstall.mjs'].includes(file) && !file.startsWith('dist/'))}`);
assert(Object.keys(manifest.exports).join(',') === '.,./mcp,./mcp/server,./readers/http' &&
  manifest.bin['capability-graph'] === './dist/cli/main.js', 'public subpaths/bin drifted');
assert(paths.every((file) => !file.startsWith('website/')), 'website files must not enter the public package');

const packageTest = runNpm(['run', 'test:package']);
process.stdout.write(packageTest);
console.log(`package boundary check passed: ${paths.length} files, website excluded`);
