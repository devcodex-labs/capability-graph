import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.env.CG_SITE_BUILD_DIR??path.join(repo,'../capability-graph-site-artifacts/site'));
const artifacts=path.resolve(process.env.CG_SITE_ARTIFACTS_DIR??path.join(repo,'../capability-graph-site-artifacts/browser'));
assert(artifacts!==repo&&!artifacts.startsWith(repo+path.sep)&&!repo.startsWith(artifacts+path.sep));await fs.mkdir(artifacts,{recursive:true});
const base=process.env.CG_SITE_BASE??'/capability-graph/';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(base)){res.writeHead(404);return res.end();}let rel=decodeURIComponent(url.pathname.slice(base.length));if(!rel||rel.endsWith('/'))rel+='index.html';const file=path.resolve(output,rel);assert(file.startsWith(output+path.sep));const data=await fs.readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
});
let browser, page, port;
const errors = [], badResponses = [], checks = [], screenshots = [], contrast = [];
const normalize = text => text.replace(/\r\n/g, '\n').trimEnd();
const keyRoutes = ['', 'getting-started/quick-start.html', 'guide/results.html',
  'reference/configuration.html', 'integrations/codex.html'];
async function contentRoutes(dir, prefix = '') {
  const routes = [];
  for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    if (item.isDirectory()) routes.push(...await contentRoutes(path.join(dir, item.name), prefix + item.name + '/'));
    else if (/\.mdx?$/.test(item.name)) routes.push(prefix + item.name.replace(/\.mdx?$/, '.html'));
  }
  return routes;
}
const routes = (await contentRoutes(path.join(repo, 'website/content'))).map(route => route === 'index.html' ? '' : route);
try {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  port = server.address().port;
  const origin = 'http://127.0.0.1:' + port + base;
  await fs.writeFile(path.join(artifacts, 'service.json'), JSON.stringify({
    command: process.execPath + ' website/scripts/browser.mjs', cwd: repo, pid: process.pid, port, url: origin
  }, null, 2));
  const executable = process.env.CG_BROWSER_EXECUTABLE ??
    (await fs.access('/usr/bin/chromium').then(() => '/usr/bin/chromium', () => undefined));
  browser = await chromium.launch({...(executable ? {executablePath: executable} : {}), headless: true, args: ['--no-sandbox']});
  for (const theme of ['light', 'dark']) for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
    const context = await browser.newContext({viewport, colorScheme: theme, reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write']});
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push({message:error.message, stack:error.stack, url:page.url()}));
    page.on('response', response => {
      if (response.url().startsWith(origin) && response.status() >= 400) badResponses.push(response.url());
    });
    const anchors = new Map(), links = [];
    for (const route of [...keyRoutes, ...routes.filter(route => !keyRoutes.includes(route))]) {
      await page.goto(origin + route); await page.locator('h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Horizontal overflow: ' + route + ' ' + theme + ' ' + viewport.width);
      const documentLinks = await page.evaluate(() => ({
        ids: [...document.querySelectorAll('[id]')].map(node => node.id),
        links: [...document.querySelectorAll('a[href]')].map(node => node.href)
      }));
      const pathname = new URL(origin + route).pathname;
      anchors.set(pathname, new Set(documentLinks.ids));
      anchors.set(pathname.replace(/\.html$/, ''), new Set(documentLinks.ids));
      links.push(...documentLinks.links);
      if (keyRoutes.includes(route)) {
        const name = (route ? route.replace(/\.html$/, '').replaceAll('/', '-') : 'home') + '-' + theme + '-' + viewport.width;
        await page.screenshot({path: path.join(artifacts, name + '.png'), fullPage: true});
        await page.screenshot({path: path.join(artifacts, name + '-viewport.png')});
        screenshots.push(name + '.png');
        const code = page.locator('pre code').first();
        if (await code.count()) {
          const colors = await page.locator('pre code span[style]').evaluateAll(nodes =>
            [...new Set(nodes.filter(node => node.textContent.trim()).map(node => getComputedStyle(node).color))]);
          assert(colors.length >= 2, 'Missing syntax colors: ' + route);
          const copy = page.getByRole('button', {name: '复制代码', exact: true}).first();
          await copy.click();
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          assert.equal(normalize(copied), normalize(await code.textContent()), 'Copy changed rendered code: ' + route);
          if (!route) assert.equal(normalize(copied),
            normalize(await fs.readFile(path.join(repo, 'examples/minimal/static.mjs'), 'utf8')), 'Home copy drift');
        }
        const samples = await page.evaluate(() => {
          const rgb = value => value.match(/[\d.]+/g)?.map(Number);
          const blend = (front, back) => front.slice(0, 3).map((value, index) => value * (front[3] ?? 1) + back[index] * (1 - (front[3] ?? 1)));
          const luminance = color => color.map(value => value / 255).map(value =>
            value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
          const selectors = ['.cg-lead', '.cg-eyebrow', '.cg-console-label', '.rp-doc p',
            '.rp-doc p > code', 'pre code span[style]'];
          return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(node =>
            node.getClientRects().length && node.textContent.trim()).slice(0, 24).map(node => {
              const style = getComputedStyle(node), layers = [];
              let ancestor = node, unsupported = false;
              while (ancestor) {
                const computed = getComputedStyle(ancestor);
                if (computed.backgroundImage !== 'none' || Number(computed.opacity) !== 1) unsupported = true;
                layers.unshift(rgb(computed.backgroundColor)); ancestor = ancestor.parentElement;
              }
              if (unsupported) return {selector, text: node.textContent.slice(0, 36), status: 'UNVERIFIED'};
              let background = [255, 255, 255];
              for (const layer of layers) if (layer) background = blend(layer, background);
              const foreground = blend(rgb(style.color), background);
              const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
              return {selector, text: node.textContent.slice(0, 36), ratio: (values[1] + .05) / (values[0] + .05)};
            }));
        });
        for (const sample of samples) if (sample.ratio !== undefined) assert(sample.ratio >= 4.5,
          'Text contrast below 4.5: ' + JSON.stringify({route, theme, ...sample}));
        contrast.push({route, theme, width: viewport.width, samples});
      }
      checks.push({route, theme, width: viewport.width, horizontalOverflow: false});
    }
    for (const link of links) {
      const url = new URL(link);
      if (!url.href.startsWith(origin) || !url.hash || url.hash === '#') continue;
      const ids = anchors.get(url.pathname);
      assert(ids, 'Unvisited local link target: ' + link);
      assert(ids.has(decodeURIComponent(url.hash.slice(1))), 'Broken rendered anchor: ' + link);
    }
    await page.goto(origin);
    const revealAppearance = async () => {
      if (!await page.getByRole('switch', {name: '深色模式'}).filter({visible:true}).count()) {
        await page.getByRole('button', {name: 'mobile hamburger', exact:true}).filter({visible:true}).first().click();
      }
    };
    await revealAppearance();
    const appearance = page.getByRole('switch', {name: '深色模式'}).filter({visible:true}).first();
    await appearance.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, theme !== 'dark');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme !== 'dark', 'Theme persistence');
    await revealAppearance(); await appearance.click();
    await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, theme === 'dark');
    await page.goto(origin + 'getting-started/quick-start.html');
    const search = page.getByRole('button', {name:'搜索文档'}).filter({visible:true}).first();
    await search.focus(); await page.keyboard.press('Enter');
    const input = page.locator('input').filter({visible:true}).first();
    await input.waitFor({state:'visible'});
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert(await input.isVisible(), 'Empty search should remain open without selecting a result');
    await input.fill('reload');
    const modal = page.locator('#__rspress_modal_container');
    const lifecycleResult = modal.locator('a[href*="/guide/lifecycle"]').first();
    await lifecycleResult.waitFor({state:'visible'}); await lifecycleResult.hover();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', {name:'Revision、重载与关闭', exact:true}).waitFor();
    await page.keyboard.press('Control+k'); await input.fill('原子');
    await modal.getByRole('link').filter({hasText:'原子'}).first().waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.matches('.cg-search-button'));
    await page.keyboard.press('Control+k'); await input.fill('读取解析结果');
    const result = modal.locator('a[href*="/guide/results"]').first();
    await result.waitFor({state:'visible'}); await result.click();
    await page.getByRole('heading', {name:'读取解析结果', exact:true}).waitFor();
    if (viewport.width === 390) {
      const menu = page.getByRole('button', {name:'菜单', exact:true});
      await menu.focus(); await page.keyboard.press('Enter');
      await page.getByRole('complementary').getByRole('link', {name:'第一个图谱', exact:true}).click();
      await page.getByRole('heading', {name:'第一个图谱', exact:true}).waitFor();
    }
    await context.close(); page = undefined;
  }
  assert.deepEqual(errors, []); assert.deepEqual(badResponses, []);
  const report = {status:'PASS', engine:await browser.version(), routes:routes.length,
    checks, screenshots, contrast, errors, badResponses};
  await fs.writeFile(path.join(artifacts, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status:'PASS', routes:routes.length, combinations:checks.length, keyScreenshots:screenshots.length, artifacts}));
} catch (error) {
  await fs.writeFile(path.join(artifacts, 'errors.json'), JSON.stringify({errors,badResponses}, null, 2));
  if (page) {
    await fs.writeFile(path.join(artifacts, 'failure.html'), await page.content());
    await page.screenshot({path:path.join(artifacts, 'failure.png'), fullPage:true});
  }
  throw error;
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  const released = !port || await new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {socket.destroy(); resolve(false);});
    socket.once('error', () => resolve(true));
  });
  await fs.writeFile(path.join(artifacts, 'cleanup.json'), JSON.stringify({pid:process.pid, port, released, browserClosed:true}, null, 2));
  assert(released, 'Browser validation server port was not released');
}
