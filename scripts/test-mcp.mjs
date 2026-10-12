import { spawnSync } from 'node:child_process';
const files = ['mcp-toolkit', 'mcp-server', 'core-cancellation', 'http-reader'].map(name => `dist-test/test/${name}.test.js`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
