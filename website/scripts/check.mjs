import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url)),content=path.join(root,'website/content');
const normalizeSnippet=text=>text.replace(/\r\n/g,'\n').trim();
async function walk(dir){const out=[];for(const d of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory()&&d.name!=='node_modules')out.push(...await walk(p));else if(d.isFile())out.push(p);}return out;}
const docs=(await walk(content)).filter(p=>/\.mdx?$/.test(p));let links=0,snippets=0;const all=[];
for(const file of docs){
 const text=await fs.readFile(file,'utf8');all.push(text);
 for(const match of text.matchAll(/<!-- (?:example|source):([^ ]+) -->\s*```[^\n]*\n([\s\S]*?)\n```/g)){
  const actual=await fs.readFile(path.join(root,match[1]),'utf8');assert.equal(normalizeSnippet(match[2]),normalizeSnippet(actual),`Example drift: ${match[1]}`);snippets++;
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
const readme=await fs.readFile(path.join(root,'README.md'),'utf8');
const publicSite=new URL(pkg.homepage),sitePrefix=publicSite.pathname.replace(/\/$/,'')+'/';
const slug=text=>text.toLowerCase().replace(/[`*]/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-');
let publicReadmeLinks=0;
async function checkPublicReadmeLink(href){
 const url=new URL(href);
 if(url.origin!==publicSite.origin||!url.pathname.startsWith(sitePrefix))return;
 const route=decodeURIComponent(url.pathname.slice(sitePrefix.length));
 assert(!route||route.endsWith('.html'),'README must link to a public HTML route: '+href);
 const relative=(route||'index.html').replace(/\.html$/,'');
 const target=(await Promise.all(['.md','.mdx'].map(async ext=>{
  const file=path.join(content,relative+ext);return await fs.stat(file).then(s=>s.isFile()?file:null,()=>null);
 }))).find(Boolean);
 assert(target,'Missing public README route '+href);
 if(url.hash){const body=await fs.readFile(target,'utf8'),anchor=decodeURIComponent(url.hash.slice(1));assert([...body.matchAll(/^#{1,6} (.+)$/gm)].some(m=>slug(m[1])===anchor)||body.includes(`id="${anchor}"`),'Broken public README anchor '+href);}
 publicReadmeLinks++;
}
assert(!/\]\((?:docs|website)\//.test(readme),'README links to an undistributed documentation source');
for(const [,href]of readme.replace(/```[^\n]*\n[\s\S]*?```/g,'').matchAll(/\]\(([^\s)]+)\)/g)){
 if(/^https?:/.test(href)){await checkPublicReadmeLink(href);continue;}
 if(/^(?:mailto:|#)/.test(href))continue;
 const relative=href.split('#')[0];
 assert(pkg.files.some(file=>relative===file||relative.startsWith(file+'/')),'README target is not distributed: '+href);
 assert(await fs.stat(path.resolve(root,relative)).then(s=>s.isFile(),()=>false),`Broken README link ${href}`);
}
assert(publicReadmeLinks>0,'README has no public documentation links');
for(const [,source,code]of readme.matchAll(/<!-- example:([^ ]+) -->\s*```[^\n]*\n([\s\S]*?)\n```/g))assert.equal(normalizeSnippet(code),normalizeSnippet(await fs.readFile(path.join(root,source),'utf8')),`README example drift ${source}`);

const parse=(file,text)=>ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const printer=ts.createPrinter({removeComments:true});
const compact=text=>text.replace(/\s+/g,'').replace(/;/g,'');
const printed=node=>compact(printer.printNode(ts.EmitHint.Unspecified,node,node.getSourceFile()));
const modules=new Map();
/** Follow only explicit public re-exports; imports do not widen the documented package surface. */
async function exportsOf(file){
 if(modules.has(file))return modules.get(file);
 const source=parse(file,await fs.readFile(file,'utf8')),result=new Map();modules.set(file,result);
 for(const node of source.statements){
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier){
   const target=path.resolve(path.dirname(file),node.moduleSpecifier.text.replace(/\.js$/,'.ts'));
   assert(target.startsWith(path.join(root,'src')+path.sep),'Export left src');
   const child=await exportsOf(target);
   if(node.exportClause&&ts.isNamedExports(node.exportClause))for(const item of node.exportClause.elements){const original=item.propertyName?.text??item.name.text;assert(child.has(original));result.set(item.name.text,child.get(original));}
   else for(const [name,value]of child)result.set(name,value);
  }else if(node.name&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))result.set(node.name.text,node);
 }
 return result;
}
const signature=node=>({parameters:node.parameters.map(parameter=>({name:parameter.name.getText(),optional:Boolean(parameter.questionToken||parameter.initializer),type:parameter.type?printed(parameter.type):''})),returns:node.type?printed(node.type):''});
const classContract=node=>node.members.filter(member=>!member.name||!ts.isPrivateIdentifier(member.name)).map(member=>({name:member.name?.getText()??'constructor',contract:'parameters'in member?signature(member):{type:member.type?printed(member.type):'',optional:Boolean(member.questionToken)}}));
const typePage=await fs.readFile(path.join(content,'reference/types.md'),'utf8');
const documented=new Map();
for(const [,code]of typePage.matchAll(/```ts[^\n]*\n([\s\S]*?)\n```/g))for(const node of parse('documented.ts',code).statements)if(node.name)documented.set(node.name.text,node);
let contracts=0;
for(const entry of Object.values(pkg.exports)){
 const file=path.join(root,entry.import.replace(/^\.\/dist\//,'src/').replace(/\.js$/,'.ts'));
 for(const [name,node]of await exportsOf(file)){
  if(name==='CapabilityGraph')continue;
  const target=documented.get(name);assert(target,`Missing public declaration ${name}`);
  if(ts.isFunctionDeclaration(node))assert.deepEqual(signature(target),signature(node),`Signature drift ${name}`);
  else if(ts.isClassDeclaration(node))assert.deepEqual(classContract(target),classContract(node),`Class drift ${name}`);
  else assert.equal(printed(target),printed(node),`Type contract drift ${name}`);
  contracts++;
 }
}
const sdkPage=await fs.readFile(path.join(content,'reference/sdk.md'),'utf8'),methods=new Map();
for(const [,code]of sdkPage.matchAll(/```ts[^\n]*\n([\s\S]*?)\n```/g)){
 if(!/^(?:static )?\w+\(/.test(code.trim()))continue;
 const declaration=parse('methods.ts',`declare class Documented {${code}}`).statements[0];
 for(const method of declaration.members)if(method.name)methods.set(method.name.text,method);
}
const graphClass=(await exportsOf(path.join(root,'src/index.ts'))).get('CapabilityGraph');
for(const method of graphClass.members.filter(node=>ts.isMethodDeclaration(node)&&!ts.isPrivateIdentifier(node.name))){
 const target=methods.get(method.name.text);assert(target,`Missing method anchor/signature ${method.name.text}`);assert.deepEqual(signature(target),signature(method),`Method drift ${method.name.text}`);
}
for(const body of [...all,readme])assert(!/npm install(?: --global)? @devcodex\/capability-graph@/.test(body),'Default tutorial installation must use the package name');
const navigation=await fs.readFile(path.join(root,'website/rspress.config.ts'),'utf8');
for(const file of docs.filter(file=>!file.endsWith('index.mdx'))){const route='/'+path.relative(content,file).replace(/\\/g,'/').replace(/\.mdx?$/,'');assert(navigation.includes(`'${route}'`),`Page missing from navigation ${route}`);}
// A symbol being mentioned is not a usable task guide. Keep the task inventory traceable.
const capabilityMap=JSON.parse(await fs.readFile(path.join(root,'website/capability-map.json'),'utf8'));
assert.equal(capabilityMap.schemaVersion,1);assert.equal(capabilityMap.productVersion,pkg.version);
const taskPage=await fs.readFile(path.join(content,'guide/capabilities.md'),'utf8');
const pageTaskIds=[...taskPage.matchAll(/^\| `([a-z][a-z0-9-]+)` \|/gm)].map(match=>match[1]);
const taskIds=capabilityMap.tasks.map(task=>task.id);
assert.equal(new Set(taskIds).size,taskIds.length,'Duplicate capability task ID');
assert.deepEqual([...pageTaskIds].sort(),[...taskIds].sort(),'Task page/inventory coverage drift');
const mappedSymbols=new Set();
for(const task of capabilityMap.tasks){
 for(const field of ['id','name','whenToUse','input','output','prerequisites','source','example','guide'])assert(typeof task[field]==='string'&&task[field].trim(),'Missing task field '+task.id+': '+field);
 assert(/^[a-z][a-z0-9-]+$/.test(task.id),'Invalid task ID '+task.id);
 for(const relative of [task.source,task.example]){
  const file=path.resolve(root,relative);assert(file.startsWith(root),'Task path escaped source');
  assert(await fs.stat(file).then(s=>s.isFile(),()=>false),'Missing task evidence '+relative);
 }
 assert(Array.isArray(task.symbols),'Missing symbol mapping '+task.id);
 for(const symbol of task.symbols){assert(merged.includes(symbol),'Unknown task symbol '+symbol);mappedSymbols.add(symbol);}
 assert(taskPage.includes(`[${task.name}](${task.guide})`),'Task guide differs from inventory '+task.id);
}
for(const symbol of [...methods.keys(),'createGraphTools','createMcpServer','createOpenAIExecutor','createCodexExecutor'])assert(mappedSymbols.has(symbol),'Public operation missing task guide '+symbol);
assert(merged.includes(']('+capabilityMap.failureGuide+')'),'Missing shared task failure guide');
console.log(JSON.stringify({status:'PASS',pages:docs.length,links,snippets,publicReadmeLinks,publicCoverage:'PASS',publicDeclarations:contracts,methodSignatures:methods.size,capabilityTasks:taskIds.length,packageBoundary:'PASS'},null,2));
