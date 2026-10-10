/** Release instructions must survive publication without claiming a stale Registry state. */
export function assertReleaseDocumentation({ version, readme, installation, home, quickstart, firstProvider, changelog }) {
  const assert = (condition, message) => { if (!condition) throw new Error(`release documentation: ${message}`); };
  for (const [name, source] of Object.entries({ readme, installation })) {
    assert(source.includes(`npm view @devcodex/capability-graph@${version} version`), `${name} must check the exact release version`);
    assert(source.includes(`npm install @devcodex/capability-graph@${version}`), `${name} must install the exact release version`);
    assert(source.includes('E404') || source.includes('未发布'), `${name} must explain availability and the fixed-source fallback`);
  }
  for (const [name, source] of Object.entries({ readme, installation, home, quickstart, firstProvider, changelog })) {
    assert(typeof source === 'string', `${name} must be provided`);
    assert(!/Registry\s*(?:当前|与当前)|Registry\s+\d+\.\d+\.\d+|待发布\s*\d+\.\d+\.\d+|\d+\.\d+\.\d+\s*(?:源码预览|预览包|（待发布）)/u.test(source),
      `${name} contains a time-dependent preview/Registry claim`);
  }
  assert(firstProvider.includes(version), 'firstProvider must match the documented package version');
  assert(installation.includes('git -C source checkout --detach FETCH_HEAD') &&
    installation.includes('40 位提交 SHA') && !/git clone[^\n]*--branch main/.test(installation),
    'source fallback must pin the documentation commit');
  assert(installation.includes('pack.json') && installation.includes('p.filename'), 'source install must use this pack result');
  assert(!/(?:此版本|本版本|当前版本)(?:尚未|未)发布/u.test(changelog), 'changelog contains a stale unpublished claim');
  assert(changelog.startsWith(`# ${version}\n`), 'changelog must identify the release without a preview badge');
}
