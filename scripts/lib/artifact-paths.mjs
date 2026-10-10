import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';

export const repositoryRoot = path.resolve(import.meta.dirname, '../..');
export const artifactsRoot = path.resolve(process.env.CG_ARTIFACTS_DIR
  || path.join(repositoryRoot, '..', `${path.basename(repositoryRoot)}-artifacts`));
const relative = path.relative(repositoryRoot, artifactsRoot);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
  throw new Error('CG_ARTIFACTS_DIR must be outside the repository');
}
if (path.relative(artifactsRoot, repositoryRoot).split(path.sep)[0] !== '..') {
  throw new Error('CG_ARTIFACTS_DIR must not contain the repository');
}

/** Resolve existing ancestors before creating or clearing an artifact directory. */
export async function assertPhysicalArtifactLocation() {
  let existing = artifactsRoot;
  const missing = [];
  for (;;) {
    try {
      const actual = path.resolve(await realpath(existing), ...missing);
      const repository = await realpath(repositoryRoot);
      const below = path.relative(repository, actual);
      const above = path.relative(actual, repository);
      if ((!below.startsWith(`..${path.sep}`) && !path.isAbsolute(below)) ||
          (!above.startsWith(`..${path.sep}`) && !path.isAbsolute(above))) {
        throw new Error('artifact location resolves inside or contains the repository');
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(existing)); existing = path.dirname(existing);
    }
  }
}

/** Scratch files belong to a dedicated directory outside the checkout. */
export async function createTemporaryDirectory(prefix) {
  if (!/^[.a-zA-Z0-9-]+$/.test(prefix)) throw new Error('invalid temporary prefix');
  await assertPhysicalArtifactLocation();
  await mkdir(artifactsRoot, { recursive: true });
  const entry = await lstat(artifactsRoot);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('artifact root must be a real directory');
  return mkdtemp(path.join(artifactsRoot, prefix));
}
