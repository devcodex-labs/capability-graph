import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateRelease, releaseNotes, checkRelease} from './check-release.mjs';
import {publicationPlan, npmJSON, fingerprint, loadArtifact} from './release-registry.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const copy=v=>structuredClone(v);
test('release requires a stable tag matching both package and lock identity',()=>{
  const options={ci:true,refType:'tag',tag:'v'+pkg.version};
  assert.doesNotThrow(()=>validateRelease(pkg,lock,options));
  assert.throws(()=>validateRelease(pkg,lock,{...options,tag:'v99.0.0'}),/Tag/);
  assert.throws(()=>validateRelease(pkg,lock,{ci:true,refType:'branch'}),/tag/);
  assert.doesNotThrow(()=>validateRelease(pkg,lock,{ci:true,refType:'branch',dryRun:true}));
  assert.throws(()=>validateRelease(pkg,lock,{...options,dryRun:true,tag:'v99.0.0'}),/Tag/);
  for(const version of ['2.0','02.0.0','2.0.0-rc.1','2.0.0+build','not-a-version'])assert.throws(()=>validateRelease({...pkg,version},lock),/stable/);
});
test('release rejects private/wrong registry packages and stale locks',()=>{
  assert.throws(()=>validateRelease({...pkg,private:true},lock),/public/);
  assert.throws(()=>validateRelease({...pkg,name:'another-package'},lock),/Capability/);
  assert.throws(()=>validateRelease({...pkg,publishConfig:{access:'public',registry:'https://another.example/'}},lock),/public/);
  const bad=copy(lock);bad.packages[''].version='99.0.0';assert.throws(()=>validateRelease(pkg,bad),/lock/);
  assert.throws(()=>validateRelease(pkg,{...lock,name:'another-package'}),/lock/);
});
test('release notes use only the new current section and reject missing/empty notes',()=>{
  assert.equal(releaseNotes('# Changelog\r\n## 2.0.0\r\n\r\nNew release.\r\n## 1.0.0\r\nOld notes.','2.0.0'),'New release.\n');
  assert.throws(()=>releaseNotes('## 1.0.0\nOld','2.0.0'),/Missing/);
  assert.throws(()=>releaseNotes('## 2.0.0\n\n## 1.0.0\nOld','2.0.0'),/empty/);
});
test('current source package/Plugin/site/runtime identities and authored notes agree',async()=>{
  assert.equal((await checkRelease()).pkg.version,pkg.version);
});
test('only a structured npm E404 establishes an absent version',()=>{
  assert.equal(npmJSON({status:1,stdout:'{"error":{"code":"E404"}}'}),undefined);
  assert.deepEqual(npmJSON({status:0,stdout:'{"integrity":"sha512-test"}'}),{integrity:'sha512-test'});
  for(const code of ['E401','E403','E429','E500','ECONNRESET','ENOENT'])assert.throws(()=>npmJSON({status:1,stdout:JSON.stringify({error:{code}})}),/absence/);
  assert.throws(()=>npmJSON({status:1,stdout:'network failed'}),/unknown/);
});
test('publication resumes identical bytes but refuses conflicts and latest downgrades',()=>{
  const local={version:'2.0.0',integrity:'sha512-exact'};
  assert.equal(publicationPlan(local,undefined,'1.0.0').publish,true);
  assert.equal(publicationPlan(local,{integrity:local.integrity},'2.0.0').publish,false);
  assert.throws(()=>publicationPlan(local,{integrity:'sha512-different'},'2.0.0'),/different/);
  assert.throws(()=>publicationPlan(local,{},'2.0.0'),/different/);
  assert.throws(()=>publicationPlan(local,undefined,'2.0.1'),/backwards/);
  assert.throws(()=>publicationPlan(local,undefined,'3.0.0'),/backwards/);
  assert.throws(()=>publicationPlan(local,undefined,'2.0.0-rc.1'),/stable/);
  assert.equal(publicationPlan(local,undefined,undefined).publish,true);
});

let directory,tarball,manifest,archive;
before(async()=>{
  const base=path.resolve(process.env.CG_RELEASE_TEST_DIR??path.join(root,'../capability-graph-release-tests'));
  assert(base!==root&&!base.startsWith(root+path.sep));await fs.mkdir(base,{recursive:true});directory=await fs.mkdtemp(path.join(base,'controls-'));
  // A synthetic archive tests guards only; real consumers are exercised by smoke:package.
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,files:['fixture.txt']}));
  await fs.writeFile(path.join(directory,'fixture.txt'),'Synthetic release-control fixture.');
  const result=spawnSync('npm',['pack','--ignore-scripts','--json','--cache',path.join(directory,'npm-cache')],{cwd:directory,encoding:'utf8',timeout:30000,shell:process.platform==='win32'});
  assert.equal(result.status,0,result.stderr);const pack=JSON.parse(result.stdout)[0];tarball=path.join(directory,pack.filename);archive=await fs.readFile(tarball);
  manifest={name:pkg.name,version:pkg.version,filename:pack.filename,...fingerprint(archive)};
});
after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});
async function reset(){await fs.writeFile(tarball,archive);await fs.writeFile(path.join(directory,'release-package.json'),JSON.stringify(manifest));await fs.writeFile(path.join(directory,'SHA256SUMS'),`${manifest.sha256}  ${manifest.filename}\n`);}
test('artifact guards accept the exact archive and reject tampering or substituted metadata',async()=>{
  await reset();assert.equal((await loadArtifact(tarball)).integrity,manifest.integrity);
  await fs.appendFile(tarball,'tampered');await assert.rejects(loadArtifact(tarball),/bytes/);
  await reset();await fs.writeFile(path.join(directory,'SHA256SUMS'),'wrong\n');await assert.rejects(loadArtifact(tarball),/checksums/);
  await reset();await fs.writeFile(path.join(directory,'release-package.json'),JSON.stringify({...manifest,version:'99.0.0'}));await assert.rejects(loadArtifact(tarball),/identity/);
});
test('even a matching hash manifest cannot authorize malformed archive contents',async()=>{
  const malformed=Buffer.from('not an npm archive'),hashes=fingerprint(malformed);
  await fs.writeFile(tarball,malformed);await fs.writeFile(path.join(directory,'release-package.json'),JSON.stringify({...manifest,...hashes}));
  await fs.writeFile(path.join(directory,'SHA256SUMS'),`${hashes.sha256}  ${manifest.filename}\n`);
  await assert.rejects(loadArtifact(tarball),/archive/);
});
test('a valid archive with another embedded version cannot be relabeled for publication',async()=>{
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify({name:pkg.name,version:'99.0.0',files:['fixture.txt']}));
  const packed=spawnSync('npm',['pack','--ignore-scripts','--json','--cache',path.join(directory,'npm-cache')],{cwd:directory,encoding:'utf8',timeout:30000,shell:process.platform==='win32'});
  assert.equal(packed.status,0,packed.stderr);
  const bytes=await fs.readFile(path.join(directory,JSON.parse(packed.stdout)[0].filename)),hashes=fingerprint(bytes);
  await fs.writeFile(tarball,bytes);await fs.writeFile(path.join(directory,'release-package.json'),JSON.stringify({...manifest,...hashes}));
  await fs.writeFile(path.join(directory,'SHA256SUMS'),`${hashes.sha256}  ${manifest.filename}\n`);
  await assert.rejects(loadArtifact(tarball),/Packed package identity/);
});
