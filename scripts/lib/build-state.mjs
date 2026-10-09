import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function files(root, directory) {
  const names = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) names.push(...await files(root, name));
    else if (entry.isFile() && entry.name !== '.build-state.json') names.push(name);
  }
  return names.sort();
}
async function digest(root, names) {
  const hash = createHash('sha256');
  for (const name of names.sort()) { const body = await readFile(path.join(root, name)); hash.update(JSON.stringify([name, body.length])); hash.update(body); }
  return hash.digest('hex');
}
async function state(root) {
  return { schemaVersion: 1,
    sourceDigest: await digest(root, [...await files(root, 'src'), 'tsconfig.json', 'package.json', 'package-lock.json', 'scripts/build.mjs', 'scripts/lib/build-state.mjs']),
    outputDigest: await digest(root, await files(root, 'dist')) };
}
/** Deterministic fingerprints allow explicit CI consumers to reject old/missing/mutated output. */
export async function writeBuildState(root) { await writeFile(path.join(root, 'dist/.build-state.json'), JSON.stringify(await state(root)) + '\n'); }
export async function assertCurrentBuild(root) {
  let actual;
  try { actual = JSON.parse(await readFile(path.join(root, 'dist/.build-state.json'), 'utf8')); } catch { throw new Error('Missing build state; run npm run build'); }
  if (JSON.stringify(actual) !== JSON.stringify(await state(root))) throw new Error('Build differs from current source or output; run npm run build');
}
