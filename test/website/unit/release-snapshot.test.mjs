import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { createTemporaryDirectory, repositoryRoot } from '../../../scripts/lib/artifact-paths.mjs';

test('manual release resume rejects a later branch checkout even when its version is unchanged', async () => {
  const root = await createTemporaryDirectory('release-snapshot-');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  try {
    const version = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
    const tag = `v${version}`;
    const files = ['package.json', 'package-lock.json', 'website/package.json', 'website/package-lock.json',
      'README.md', `changelogs/${version}.md`, 'scripts/lib/artifact-paths.mjs', 'scripts/lib/website-paths.mjs', 'scripts/validation/website/check-release.mjs',
      'scripts/validation/website/lib/release-documentation.mjs', 'website/docs/getting-started/installation.mdx',
      'website/docs/getting-started/index.mdx', 'website/docs/getting-started/first-provider.mdx', 'website/docs/index.mdx'];
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await cp(path.join(repositoryRoot, file), path.join(root, file));
    }
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/product.js'), 'export const snapshot = "tag";\n');
    git('init', '--quiet');
    git('add', '.');
    const commit = () => git('-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'release fixture');
    commit();
    const frozen = git('rev-parse', 'HEAD');
    git('tag', tag);
    const run = (releaseCommit = frozen, event = 'workflow_dispatch') => {
      const env = { ...process.env, RELEASE_TAG: tag, RELEASE_COMMIT: releaseCommit,
        GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: event === 'workflow_dispatch' ? 'branch' : 'tag' };
      delete env.GITHUB_OUTPUT;
      delete env.CG_ARTIFACTS_DIR; // The isolated Git fixture is itself below the real artifact root.
      return spawnSync(process.execPath, ['scripts/validation/website/check-release.mjs'],
        { cwd: root, env, encoding: 'utf8', windowsHide: true });
    };
    assert.equal(run().status, 0, 'tag snapshot is a valid manual resume');
    await writeFile(path.join(root, 'src/product.js'), 'export const snapshot = "later branch";\n');
    git('add', '.'); commit();
    const branch = git('rev-parse', 'HEAD');
    assert.notEqual(branch, frozen);
    const later = run();
    assert.notEqual(later.status, 0);
    assert.match(later.stderr, /checkout must match the immutable release commit/);
    const forged = run(branch);
    assert.notEqual(forged.status, 0);
    assert.match(forged.stderr, /commit must match the immutable release tag/);
    git('checkout', '--quiet', '--detach', frozen);
    for (const event of ['workflow_dispatch', 'push']) {
      const result = run(frozen, event);
      assert.equal(result.status, 0, result.stderr);
      assert(result.stdout.includes(frozen));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('publication depends on all frozen-commit compatibility, framework and documentation workflows', async () => {
  const readWorkflow = async (name) => parseDocument(await readFile(path.join(repositoryRoot, `.github/workflows/${name}.yml`), 'utf8')).toJSON();
  const release = await readWorkflow('release');
  assert.deepEqual(release.jobs.gates.needs, ['freeze', 'compatibility', 'framework', 'documentation']);
  assert.deepEqual(release.jobs.package.needs, ['freeze', 'gates']);
  for (const [name, file] of [['compatibility', 'ci'], ['framework', 'vextjs-ci'], ['documentation', 'docs-ci']]) {
    const call = release.jobs[name];
    assert.equal(call.uses, `./.github/workflows/${file}.yml`);
    assert.equal(call.with.commit, '${{ needs.freeze.outputs.release_commit }}');
    assert.equal(call.needs, 'freeze');
    assert.equal(call.if, undefined, 'failed or pending prerequisites cannot be bypassed with always()');
    assert.equal(call['continue-on-error'], undefined);
    const workflow = await readWorkflow(file);
    assert.equal(workflow.on.workflow_call.inputs.commit.required, true);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job['continue-on-error'], undefined);
      const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
      for (const checkout of checkouts) assert.equal(checkout.with.ref, '${{ inputs.commit || github.sha }}');
    }
  }
  assert.equal(release.jobs.gates.if, undefined);
  assert.equal(release.jobs.package.if, undefined);
});

test('all release product jobs use the frozen commit and the initial resume checkout uses the tag', async () => {
  const workflow = parseDocument(await readFile(path.join(repositoryRoot, '.github/workflows/release.yml'), 'utf8')).toJSON();
  const checkouts = (job) => job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts(workflow.jobs.freeze)[0].with.ref,
    "${{ github.event_name == 'workflow_dispatch' && format('refs/tags/{0}', github.event.inputs.release_tag) || github.ref }}");
  for (const name of ['gates', 'package', 'pages-build', 'public-verification']) {
    assert.equal(checkouts(workflow.jobs[name]).length, 1);
    assert.equal(checkouts(workflow.jobs[name])[0].with.ref, '${{ needs.freeze.outputs.release_commit }}', name);
  }
  assert.equal(checkouts(workflow.jobs.deploy)[0].with.ref, '${{ needs.freeze.outputs.documentation_commit }}');
});
