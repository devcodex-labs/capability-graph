import { assertCurrentBuild } from '../lib/build-state.mjs';
import { repositoryRoot } from '../lib/website-paths.mjs';
await assertCurrentBuild(repositoryRoot);
console.log('Current source and complete build output fingerprints verified');
