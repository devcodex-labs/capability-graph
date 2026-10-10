import { mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createTemporaryDirectory } from '../lib/artifact-paths.mjs';
import { validateVextjs } from './vextjs.mjs';
import { validateVextSession } from './vextjs-session.mjs';
import { validateProviderSources } from './provider-sources.mjs';
import { validateVextDocumentation } from './vextjs-documentation.mjs';

const [frameworkArg, sourceIdentity] = process.argv.slice(2);
if (!frameworkArg || !sourceIdentity) throw new Error('Usage: node scripts/validation/vextjs-compatibility.mjs <fixed-installed-framework-root> <source-identity>');
const frameworkRoot = await realpath(frameworkArg);
const projectRoot = await createTemporaryDirectory('capability-graph-vext-compatibility-');
try {
  await mkdir(path.join(projectRoot, 'src/config'), { recursive: true });
  await mkdir(path.join(projectRoot, 'node_modules'));
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'vext-compatibility-consumer', private: true, type: 'module' }));
  await writeFile(path.join(projectRoot, 'src/config/default.js'), 'export default { logger: { level: "silent" }, frontend: { enabled: false }, openapi: { enabled: false } };\n');
  await symlink(frameworkRoot, path.join(projectRoot, 'node_modules/vextjs'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(path.join(frameworkRoot, 'node_modules/monsqlize'), path.join(projectRoot, 'node_modules/monsqlize'), process.platform === 'win32' ? 'junction' : 'dir');
  const native = await validateVextjs({ frameworkRoot, projectRoot, sourceIdentity });
  const documents = await validateProviderSources({ sourceRoot: frameworkRoot, installedProject: projectRoot, sourceIdentity });
  const session = await validateVextSession(frameworkRoot);
  const documentation = await validateVextDocumentation({ frameworkRoot, sourceIdentity });
  console.log(JSON.stringify({ native, documents, session, documentation }, null, 2));
} finally { await rm(projectRoot, { recursive: true, force: true }); }
