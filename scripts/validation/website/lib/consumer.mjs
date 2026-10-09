import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from '../../../lib/website-paths.mjs';

/** Install the actual public tarball, without rewriting tutorial imports. */
export async function installLocalConsumer(root, { types = false, dependencies = [] } = {}) {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('run consumer checks through npm');
  const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024
  });
  const [pack] = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', root], repositoryRoot));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'docs-consumer', private: true, type: 'module' }));
  const packages = [path.join(root, pack.filename), ...dependencies];
  if (types) {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
    packages.push(`@types/node@${manifest.devDependencies['@types/node']}`);
  }
  run(['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packages], root);
}
