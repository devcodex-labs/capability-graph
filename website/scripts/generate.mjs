import { resetGeneratedRoot } from '../../scripts/lib/website-paths.mjs';

await resetGeneratedRoot();
await import('./generate-contract-reference.mjs');
await import('./sync-snippets.mjs');
