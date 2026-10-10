import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const verified = new WeakSet();
export const isVerifiedSource = (source) => verified.has(source);

/** Verify a fixed checkout and the installed build against source/output fingerprints.
 * A version or caller-provided identity string alone is never accepted as proof. */
export async function verifyVextSource({ frameworkRoot, sourceRoot = frameworkRoot, sourceIdentity }) {
  frameworkRoot = await realpath(frameworkRoot); sourceRoot = await realpath(sourceRoot);
  const commit = sourceIdentity?.replace(/^git:/, '');
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'A complete fixed Git commit is required');
  const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(await realpath(git('rev-parse', '--show-toplevel')), sourceRoot, 'Source must be the selected checkout, not an enclosing repository');
  assert.equal(git('rev-parse', 'HEAD'), commit, 'Declared source commit differs from the checkout');
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Fixed tracked source has changed');
  const { inspectBuildInputs } = await import(pathToFileURL(path.join(sourceRoot, 'scripts/implementation-manifest.mjs')).href);
  const { fingerprintImplementationTree } = await import(pathToFileURL(path.join(sourceRoot, 'src/lib/project/implementation-fingerprint.mjs')).href);
  const inputs = inspectBuildInputs(sourceRoot);
  const manifest = JSON.parse(await readFile(path.join(frameworkRoot, 'dist/.implementation.json'), 'utf8'));
  assert.equal(manifest.state, 'complete'); assert.equal(manifest.inputDigest, inputs.inputDigest);
  assert.equal(manifest.outputDigest, fingerprintImplementationTree(path.join(frameworkRoot, 'dist')), 'Installed output fingerprint differs from its manifest');
  assert.equal(sha256(await readFile(path.join(frameworkRoot, 'package.json'))), sha256(await readFile(path.join(sourceRoot, 'package.json'))));
  const result = { identity: `git:${commit}`, kind: frameworkRoot === sourceRoot ? 'verified-checkout-build' : 'verified-installed-build',
    commit, packageName: 'vextjs', version: inputs.packageVersion, inputDigest: manifest.inputDigest, outputDigest: manifest.outputDigest,
    implementationDigest: manifest.digest, packageJsonSha256: sha256(await readFile(path.join(frameworkRoot, 'package.json'))) };
  verified.add(result); return Object.freeze(result);
}
