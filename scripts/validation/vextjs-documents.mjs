import { validateProviderSources } from './provider-sources.mjs';

// Compatibility entrypoint: direct original sources, never silently copied fixtures.
const [sourceRoot, installedProject, sourceIdentity, flag] = process.argv.slice(2);
if (!sourceRoot || !installedProject || !sourceIdentity) throw new Error('Usage: vextjs-documents.mjs <fixed-source-root> <installed-project> <commit> [--https]');
console.log(JSON.stringify(await validateProviderSources({ sourceRoot, installedProject, sourceIdentity, includeHttps: flag === '--https' }), null, 2));
