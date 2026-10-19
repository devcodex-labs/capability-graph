import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.env.CG_SITE_BUILD_DIR??path.join(repo,'../capability-graph-site-artifacts/site'));
const artifacts=path.resolve(process.env.CG_SITE_ARTIFACTS_DIR??path.join(repo,'../capability-graph-site-artifacts/browser'));
assert(artifacts!==repo&&!artifacts.startsWith(repo+path.sep)&&!repo.startsWith(artifacts+path.sep));await fs.mkdir(artifacts,{recursive:true});
const base=process.env.CG_SITE_BASE??'/capability-graph/';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(base)){res.writeHead(404);return res.end();}let rel=decodeURIComponent(url.pathname.slice(base.length));if(!rel||rel.endsWith('/'))rel+='index.html';const file=path.resolve(output,rel);assert(file.startsWith(output+path.sep));const data=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}${base}`;
const executable=process.env.CG_BROWSER_EXECUTABLE??(await fs.access('/usr/bin/chromium').then(()=>'/usr/bin/chromium',()=>undefined));
const browser=await chromium.launch({...(executable?{executablePath:executable}:{}),headless:true,args:['--no-sandbox']});
const errors=[],badResponses=[];const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)badResponses.push(r.url());});
page.setDefaultTimeout(10000);
try{
 await page.goto(origin);await page.getByRole('heading',{name:'让能力有据可查。'}).waitFor();await page.screenshot({path:path.join(artifacts,'home-desktop.png'),fullPage:true});
 await page.getByRole('link',{name:'开始使用 →',exact:true}).click();await page.getByRole('heading',{name:'第一个图谱',exact:true}).waitFor();
 assert((await page.locator('body').innerText()).includes('node static.mjs'));
 const search=page.getByRole('button',{name:/搜索|Search/}).first();await search.click();
 const input=page.locator('input').filter({visible:true}).first();await input.fill('reload');
 const modal=page.locator('#__rspress_modal_container');
 const lifecycleResult=modal.locator('a[href*="/guide/lifecycle"]').first();await lifecycleResult.waitFor({state:'visible'});assert((await lifecycleResult.innerText()).includes('Revision'));await lifecycleResult.click();await page.getByRole('heading',{name:'Revision、重载与关闭',exact:true}).waitFor();
 await search.click();await page.locator('input').filter({visible:true}).first().fill('原子');
 await modal.getByRole('link').filter({hasText:'原子'}).first().waitFor({state:'visible'});
 await page.keyboard.press('Escape');await modal.locator('.rp-search-panel__modal').waitFor({state:'hidden'});
 await page.goto(origin+'reference/configuration.html');await page.getByRole('heading',{name:'完整配置参考',exact:true}).waitFor();assert((await page.locator('body').innerText()).includes('maxProviderBytes'));await page.screenshot({path:path.join(artifacts,'configuration-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.goto(origin);await page.getByRole('heading',{name:'让能力有据可查。'}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Home horizontally overflows');await page.screenshot({path:path.join(artifacts,'home-mobile.png'),fullPage:true});
 await page.goto(origin+'integrations/codex.html');await page.getByRole('heading',{name:'Codex 便捷登记',exact:true}).waitFor();await page.screenshot({path:path.join(artifacts,'codex-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'mobile hamburger',exact:true}).click();await page.getByRole('link',{name:'指南',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'mobile hamburger',exact:true}).click();
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('link',{name:'第一个图谱',exact:true}).click();await page.getByRole('heading',{name:'第一个图谱',exact:true}).waitFor();
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'复制代码',exact:true}).first().click();assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('providerId'));
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(badResponses.length,0,JSON.stringify(badResponses));
 const report={status:'PASS',engine:await browser.version(),checks:['home','quick-start navigation','API-name search and result navigation','Chinese search and Escape','configuration reference','390px responsive home','mobile top navigation','mobile sidebar navigation','copy code to clipboard'],errors,badResponses};await fs.writeFile(path.join(artifacts,'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){await fs.writeFile(path.join(artifacts,'failure.html'),await page.content());await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
