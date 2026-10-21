import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
const website=fileURLToPath(new URL('../',import.meta.url)),repo=path.dirname(website);
const output=path.resolve(process.env.CG_SITE_BUILD_DIR??path.join(repo,'../capability-graph-site-artifacts/site'));
if(output===repo||output.startsWith(repo+path.sep)||repo.startsWith(output+path.sep))throw new Error('Site output must be outside the source tree');
const verb=process.argv[2];if(!['dev','build','preview'].includes(verb))throw new Error('Choose dev, build or preview');
const result=spawnSync(process.execPath,[path.join(website,'node_modules/@rspress/core/bin/rspress.js'),verb,...process.argv.slice(3)],{cwd:website,env:{...process.env,CG_SITE_BUILD_DIR:output},stdio:'inherit'});
if(result.error)throw result.error;
if(result.status===0&&verb==='build'){
 const pages=[];
 async function scan(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await scan(p);else if(/\.mdx?$/.test(e.name)&&e.name!=='index.mdx'){const text=await fs.readFile(p,'utf8');const rel=path.relative(path.join(website,'content'),p).replace(/\\/g,'/').replace(/\.mdx?$/,'');pages.push({title:text.match(/^# (.+)$/m)?.[1]??rel,path:rel});}}}
 await scan(path.join(website,'content'));pages.sort((a,b)=>a.path.localeCompare(b.path));
 const url=(process.env.CG_SITE_URL??'https://devcodex-labs.github.io/capability-graph').replace(/\/$/,'');
 await fs.writeFile(path.join(output,'llms.txt'),'# Capability Graph v2.1.0\n\n静态 JSON 声明驱动的能力图谱。通过 npm install @devcodex/capability-graph 安装。站点随 main 更新，实际安装版本请在消费项目用 npm ls 核对。\n\n'+pages.map(p=>`- [${p.title}](${url}/${p.path}.html)`).join('\n')+'\n');
 await fs.writeFile(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${url}/sitemap.xml\n`);await fs.writeFile(path.join(output,'.nojekyll'),'');
}
process.exitCode=result.status??1;
