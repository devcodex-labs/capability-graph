import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { artifactsRoot, assertPhysicalArtifactLocation, repositoryRoot } from './artifact-paths.mjs';

export const websiteRoot = path.join(repositoryRoot, 'website');
export const websiteFixtureRoot = path.join(repositoryRoot, 'test/fixtures/website');
export const generatedRoot = path.join(artifactsRoot, 'website/generated');
export const siteOutputRoot = path.join(artifactsRoot, 'website/doc_build');
export const browserOutputRoot = path.join(artifactsRoot, 'website/playwright');

/** Only these two generated directories may be recursively replaced. */
export async function resetGeneratedDirectory(directory) {
  if (![generatedRoot, siteOutputRoot].includes(directory)) throw new Error('refusing unowned generated directory');
  await assertPhysicalArtifactLocation();
  for (const parent of [artifactsRoot, path.dirname(directory)]) {
    await mkdir(parent, { recursive: true });
    const entry = await lstat(parent);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('artifact parents must be real directories');
  }
  try {
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`generated root must be a real directory: ${directory}`);
    }
    await rm(directory, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(directory, { recursive: true });
}

/** Preserve builds, test evidence and history when regenerating snippets. */
export async function resetGeneratedRoot() {
  await resetGeneratedDirectory(generatedRoot);
  await mkdir(path.join(generatedRoot, 'contracts'), { recursive: true });
  await mkdir(path.join(generatedRoot, 'snippets'), { recursive: true });
}
