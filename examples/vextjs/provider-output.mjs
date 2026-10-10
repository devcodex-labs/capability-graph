import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Never overwrite an earlier export or generate verification material inside the source repository. */
export async function createProviderOutput(outputDir, repositoryRoot) {
  const parent = await realpath(path.dirname(outputDir));
  const repository = await realpath(repositoryRoot);
  const output = path.join(parent, path.basename(outputDir));
  const below = path.relative(repository, output); const above = path.relative(output, repository);
  if ((!below.startsWith('..' + path.sep) && !path.isAbsolute(below)) ||
      (!above.startsWith('..' + path.sep) && !path.isAbsolute(above))) throw new Error('Generated Provider must be outside the repository');
  await mkdir(output);
  for (const directory of ['knowledge', 'capabilities', 'metadata']) await mkdir(path.join(output, directory));
  return output;
}
