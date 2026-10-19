import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),content=path.join(root,'website/content');
async function walk(dir){const out=[];for(const d of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory()&&d.name!=='node_modules')out.push(...await walk(p));else if(d.isFile())out.push(p);}return out;}
const docs=(await walk(content)).filter(p=>/\.mdx?$/.test(p));let links=0,snippets=0;const all=[];
for(const file of docs){
 const text=await fs.readFile(file,'utf8');all.push(text);
 for(const match of text.matchAll(/<!-- (?:example|source):([^ ]+) -->\s*```[^\n]*\n([\s\S]*?)\n```/g)){
  const actual=await fs.readFile(path.join(root,match[1]),'utf8');assert.equal(match[2].trim(),actual.trim(),`Example drift: ${match[1]}`);snippets++;
 }
 const prose=text.replace(/```[^\n]*\n[\s\S]*?```/g,'');
 for(const [,href] of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
  if(/^(?:https?:|mailto:|#)/.test(href))continue;
  const [plain,anchor]=href.split('#');const clean=plain.replace(/\.(?:html|mdx?)$/,'');
  const p=plain.startsWith('/')?path.join(content,clean):path.resolve(path.dirname(file),clean);
  const candidate=(await Promise.all([p+'.md',p+'.mdx',path.join(p,'index.md'),path.join(p,'index.mdx'),p].map(async v=>await fs.stat(v).then(s=>s.isFile()?v:null,()=>null)))).find(Boolean);
  assert(candidate,`Broken link in ${path.relative(root,file)}: ${href}`);
  if(anchor){const target=await fs.readFile(candidate,'utf8');const slug=s=>s.toLowerCase().replace(/[`*]/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-');assert([...target.matchAll(/^#{1,6} (.+)$/gm)].some(m=>slug(m[1])===decodeURIComponent(anchor))||target.includes(`id="${anchor}"`),`Broken anchor: ${href}`);}
  links++;
 }
}
const merged=all.join('\n');
for(const name of ['open','listProviders','listCatalog','getCapabilities','resolve','readDocument','match','reload','close','createGraphTools','createMcpServer','createOpenAIExecutor','createCodexExecutor'])assert(merged.includes(name),`Undocumented public entry ${name}`);
const types=await fs.readFile(path.join(root,'src/types.ts'),'utf8');for(const [,name]of types.matchAll(/^export (?:interface|type) (\w+)/gm))assert(merged.includes(name),`Missing type ${name}`);
for(const file of (await walk(path.join(root,'src'))).filter(p=>p.endsWith('.ts'))){const text=await fs.readFile(file,'utf8');for(const [,code]of text.matchAll(/['"](CG_[A-Z_]+)['"]/g))assert(merged.includes(code),`Missing error ${code}`);}
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));assert(!pkg.files.includes('docs'));assert(!pkg.files.includes('website'));await assert.rejects(fs.stat(path.join(root,'docs')),{code:'ENOENT'});
const readme=await fs.readFile(path.join(root,'README.md'),'utf8');assert(!/\]\(docs\//.test(readme),'README still links to root docs');
for(const [,href]of readme.replace(/```[^\n]*\n[\s\S]*?```/g,'').matchAll(/\]\(([^\s)]+)\)/g)){
 if(/^(?:https?:|mailto:|#)/.test(href))continue;
 assert(await fs.stat(path.resolve(root,href.split('#')[0])).then(s=>s.isFile(),()=>false),`Broken README link ${href}`);
}
for(const [,source,code]of readme.matchAll(/<!-- example:([^ ]+) -->\s*```[^\n]*\n([\s\S]*?)\n```/g))assert.equal(code.trim(),(await fs.readFile(path.join(root,source),'utf8')).trim(),`README example drift ${source}`);
console.log(JSON.stringify({status:'PASS',pages:docs.length,links,snippets,publicCoverage:'PASS',packageBoundary:'PASS'},null,2));
