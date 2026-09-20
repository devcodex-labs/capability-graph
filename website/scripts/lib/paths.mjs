import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const websiteRoot = path.resolve(import.meta.dirname, '..', '..');
export const repositoryRoot = path.resolve(websiteRoot, '..');
export const generatedRoot = path.join(websiteRoot, 'generated');

/** Reset only the exact website-owned generated directory and never follow a link. */
export async function resetGeneratedRoot() {
  const expected = path.resolve(websiteRoot, 'generated');
  if (path.resolve(generatedRoot) !== expected || path.dirname(expected) !== websiteRoot) {
    throw new Error(`refusing unsafe generated root: ${generatedRoot}`);
  }
  try {
    const entry = await lstat(generatedRoot);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`generated root must be a real directory: ${generatedRoot}`);
    }
    await rm(generatedRoot, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.join(generatedRoot, 'contracts'), { recursive: true });
  await mkdir(path.join(generatedRoot, 'snippets'), { recursive: true });
}
