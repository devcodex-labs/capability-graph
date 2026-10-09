const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const target = process.argv[2];
const latest = process.argv[3];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parse(version) {
  const match = semver.exec(version);
  assert(match, `expected a SemVer, received ${version}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? null
  };
}

function compareCore(left, right) {
  const a = left.core;
  const b = right.core;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

const targetVersion = parse(target);
assert(targetVersion.prerelease === null, `expected a stable SemVer, received ${target}`);

if (latest) {
  const latestVersion = parse(latest);
  const coreOrder = compareCore(targetVersion, latestVersion);
  const promotesSameCorePrerelease = coreOrder === 0 && latestVersion.prerelease !== null;
  assert(coreOrder > 0 || promotesSameCorePrerelease,
    `release ${target} is not newer than npm latest ${latest}`);
}
console.log(`release order passed: ${latest || '<first>'} -> ${target}`);
