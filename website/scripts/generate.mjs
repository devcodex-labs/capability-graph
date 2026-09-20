import { resetGeneratedRoot } from './lib/paths.mjs';

await resetGeneratedRoot();
await import('./generate-contract-reference.mjs');
await import('./sync-snippets.mjs');
