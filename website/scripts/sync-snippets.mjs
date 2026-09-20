import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generatedRoot, websiteRoot } from './lib/paths.mjs';

const fixtureRoot = path.join(websiteRoot, 'fixtures', 'first-provider');
const files = ['provider.json', 'route.capability.json', 'route-http.capability.json'];
const snapshot = {};
for (const file of files) {
  snapshot[file] = JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8'));
}

await writeFile(
  path.join(generatedRoot, 'snippets', 'first-provider.json'),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  'utf8'
);

console.log(`synced ${files.length} First Provider fixture files`);
