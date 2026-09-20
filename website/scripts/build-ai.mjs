import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { websiteRoot } from './lib/paths.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const executable = path.join(websiteRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'rspress.cmd' : 'rspress');
await new Promise((resolve, reject) => {
  const child = spawn(executable, ['build'], {
    cwd: websiteRoot,
    env: { ...process.env, DOCS_ENABLE_LLMS: 'true' },
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Rspress AI build exited with ${code}`)));
});

const outputRoot = path.join(websiteRoot, 'doc_build');
const llmsPath = path.join(outputRoot, 'llms.txt');
const fullPath = path.join(outputRoot, 'llms-full.txt');
await access(llmsPath);
await access(fullPath);
const llms = await readFile(llmsPath, 'utf8');
const full = await readFile(fullPath, 'utf8');
for (const section of ['Getting Started', 'Concepts', 'Guides', 'Integrations', 'Examples', 'Reference', 'Troubleshooting']) {
  assert(llms.includes(section), `llms.txt is missing ${section}`);
}
for (const boundary of ['Capability Graph', 'Provider', 'MCP', 'CapabilityGraph.open']) {
  assert(full.includes(boundary), `llms-full.txt is missing ${boundary}`);
}
assert(full.includes('```'), 'llms-full.txt must retain code fences');
console.log('AI documentation check passed: llms.txt and llms-full.txt');
