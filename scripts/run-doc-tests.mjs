import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../test/website/unit/', import.meta.url));
// Node 20 does not expand literal globs on Windows; enumerate actual tests on every host.
const files = (await readdir(root)).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(root, name));
if (!files.length) throw new Error('No documentation unit tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
