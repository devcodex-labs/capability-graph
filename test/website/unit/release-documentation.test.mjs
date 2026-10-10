import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { repositoryRoot } from '../../../scripts/lib/artifact-paths.mjs';
import { assertReleaseDocumentation } from '../../../scripts/validation/website/lib/release-documentation.mjs';
import path from 'node:path';

test('release instructions reject stale installs and preview claims while allowing historical migrations', async () => {
  const version = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
  const files = { readme: 'README.md', installation: 'website/docs/getting-started/installation.mdx',
    home: 'website/docs/index.mdx', quickstart: 'website/docs/getting-started/index.mdx', changelog: `changelogs/${version}.md` };
  const current = { version, ...Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
    [key, await readFile(path.join(repositoryRoot, file), 'utf8')])))};
  assertReleaseDocumentation(current);
  assertReleaseDocumentation({ ...current, installation: current.installation + '\n历史：1.0.0 迁移到 1.0.1。' });
  for (const mutation of [
    { installation: current.installation.replaceAll(`npm install @devcodex/capability-graph@${version}`, 'npm install @devcodex/capability-graph@1.0.1') },
    { home: current.home + '\nRegistry 当前已发布 1.0.1；仓库为待发布 1.1.0。' },
    { changelog: `# ${version}（待发布）\n` },
    { changelog: `# ${version}\n此版本尚未发布到 Registry。` },
    { installation: current.installation.replace('git -C source checkout --detach FETCH_HEAD', 'git checkout main') },
  ]) assert.throws(() => assertReleaseDocumentation({ ...current, ...mutation }), /release documentation/);
});
