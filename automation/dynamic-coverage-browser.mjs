// Assert actual editorial text, not merely Arabic headings. Live mode never mocks site data.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {editorialCoverage,scopedTranslation,changeRecordId} from '../assets/js/editorial-scope.js';
const root=resolve(process.argv[2]||'_site'),out=process.env.PW_COVERAGE_DIR||'.sync/coverage-browser';
const live=process.env.PW_SITE_URL;let server,browser;
const clean=s=>(s||'').replace(/[\u2066-\u2069]/g,'').trim();
try{
 if(!live){server=http.createServer(async(req,res)=>{try{let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(file!==root&&!file.startsWith(root+sep))throw Error();if((await stat(file)).isDirectory())file=resolve(file,'index.html');const body=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'})[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen({port:8096,host:'127.0.0.1',backlog:512},r));}
 const base=live||'http://127.0.0.1:8096/';
 const get=async path=>{const r=await fetch(new URL(path+'?coverage='+Date.now(),base));assert.equal(r.status,200,path);return r.json();};
 const [deployedData,human,automatic,catalog,deployedPin]=await Promise.all(['data/tracker.json','assets/i18n/content/ar.json','assets/i18n/content/ar.auto.json','assets/i18n/news/ar.json','data/pinned.json'].map(get));
 const catalogs={human,automatic,catalog},coverage=editorialCoverage(deployedData,catalogs,deployedPin);
 let pending={};if(process.env.PW_ALLOW_QUEUED_TRANSLATIONS==='1')pending=JSON.parse(await readFile('automation/state/news-translations.json','utf8')).dynamic?.pending||{};
 const unreported=coverage.missing.filter(e=>!pending[JSON.stringify([e.id,e.field])]?.lastError);
 assert.equal(unreported.length,0,JSON.stringify(unreported.map(({id,field})=>({id,field})),null,2));
 if(process.env.PW_ALLOW_QUEUED_TRANSLATIONS!=='1')assert.equal(coverage.missing.length,0,'Current dynamic content must have complete translation coverage');
 const expected=(source,id,field,lang)=>clean(lang==='en'?source:scopedTranslation(source,id,field,catalogs).value);
 const results=[],errors=[],httpErrors=[],requestsFailed=[];
 browser=await chromium.launch({channel:process.env.PW_BROWSER||'msedge',headless:true});
 await mkdir(out,{recursive:true});
 for(const width of [1600,390])for(const lang of ['ar','en']){
  const page=await browser.newPage({viewport:{width,height:1000},locale:lang==='ar'?'ar-SA':'en-US'});
  await page.addInitScript(lang=>localStorage.setItem('pw-lang',lang),lang);
  if(!live)await page.route('**/assets/js/sync-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const LIVE_SYNC=false;export const SCORING_HASH="";export const POLL_MS=60000;'}));
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
  page.on('requestfailed',r=>{if(r.url().startsWith(base))requestsFailed.push({url:r.url(),error:r.failure()?.errorText});});
  let observedLive,observedPin;
  page.on('response',async r=>{if(r.url().startsWith('https://portwatch-vi.xyz/data/tracker.json'))try{observedLive=await r.json();}catch{}});
  page.on('response',async r=>{if(r.url().startsWith('https://portwatch-vi.xyz/data/pinned.json'))try{observedPin=await r.json();}catch{}});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
  await page.locator('details.fold').evaluateAll(els=>els.forEach(e=>e.open=true));
  await page.locator('[data-toggle]').evaluateAll(els=>els.forEach(e=>{if(e.getAttribute('aria-expanded')==='false')e.click();}));
  const data=observedLive||deployedData,pin=observedPin||deployedPin,actualCoverage=editorialCoverage(data,catalogs,pin);
  if(live){
   const unexpected=actualCoverage.missing.filter(e=>!pending[JSON.stringify([e.id,e.field])]?.lastError);
   assert.equal(unexpected.length,0,JSON.stringify(unexpected.map(({id,field})=>({id,field})),null,2));
   if(process.env.PW_ALLOW_QUEUED_TRANSLATIONS!=='1')assert.equal(actualCoverage.missing.length,0,'Live dynamic content must be fully translated');
  }
  if(pin?.show!==false&&pin?.text){
   const pinExpected=expected(pin.text,'pinned:current','text',lang).slice(0,500).replace(/\*\*(.+?)\*\*/g,'$1'),prefix=pinExpected.split(/https:\/\//)[0].trim();
   await page.waitForFunction(()=>!document.querySelector('#pinned').hidden);
   assert(clean(await page.locator('#pinned .pin-text').textContent()).startsWith(prefix));
   assert.equal(await page.locator('#pinned .pin-name').textContent(),pin.name||'4lwayz');assert.equal(await page.locator('#pinned .pin-time').getAttribute('datetime'),pin.updated);
   for(const a of await page.locator('#pinned .pin-text a').all())assert(pin.text.includes(await a.getAttribute('href')));
  }
  const heads=page.locator('.headlines li a');assert.equal(await heads.count(),Math.min(10,data.headlines.length));
  for(const[hIndex,h]of data.headlines.slice(0,10).entries()){
   assert.equal(clean(await heads.nth(hIndex).textContent()),expected(h.title,`headline:${h.link}`,'title',lang));assert.equal(await heads.nth(hIndex).getAttribute('href'),h.link);
  }
  const changes=[...data.changes].reverse().slice(0,12),changeNodes=page.locator('#changes-list li>span:last-child');assert.equal(await changeNodes.count(),changes.length);
  for(const[i,c]of changes.entries())assert.equal(clean(await changeNodes.nth(i).textContent()),expected(c.text,changeRecordId(c),'text',lang));
  let summaries=0,highlights=0,blockers=0;
  for(const e of data.efforts.filter(e=>!e.nuked)){
   const card=page.locator(`[id="effort-${e.id}"]`);if(!await card.count())continue;
   const summary=card.locator('.e-summary,.w-name>p');if(await summary.count()){assert.equal(clean(await summary.first().textContent()),expected(e.summary,`project:${e.id}`,'summary',lang),e.id+' summary');summaries++;}
   for(const[field,selector]of[['highlights','.works li'],['blockers','.blocks li']]){
    const nodes=card.locator(selector);if(!await nodes.count())continue;
    assert.equal(await nodes.count(),e[field].length);
    for(const[i,source]of e[field].entries())assert.equal(clean(await nodes.nth(i).textContent()),expected(source,`project:${e.id}`,`${field}.${i}`,lang),e.id+' '+field+'.'+i);
    if(field==='highlights')highlights+=await nodes.count();else blockers+=await nodes.count();
   }
   if(e.provenOn&&await card.locator('.gw-proven').count())assert(clean(await card.locator('.gw-proven').textContent()).includes(expected(e.provenOn,`project:${e.id}`,'provenOn',lang)));
  }
  assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const clipped=await page.locator('.e-summary,.notes li,.gw-proven').evaluateAll(els=>els.filter(e=>e.checkVisibility()&&(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2)).map(e=>e.closest('[id^="effort-"]')?.id));assert.deepEqual(clipped,[]);
  if(lang==='ar')for(const[name,selector]of[['headlines','.headlines'],['changes','#changes'],['project','#effort-dexnom'],['pinned','#pinned']]){const el=page.locator(selector);if(!await el.isVisible())continue;await el.scrollIntoViewIfNeeded();await el.screenshot({path:`${out}/${name}-${width}.png`});}
  results.push({width,lang,headlines:await heads.count(),changes:changes.length,summaries,highlights,blockers,coverage:actualCoverage.sections});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(requestsFailed,[]);
 await writeFile(`${out}/report.json`,JSON.stringify({base,coverage:coverage.sections,missing:coverage.missing,results,errors,httpErrors,requestsFailed},null,2));
 console.log(JSON.stringify({passed:results.length,coverage:coverage.sections,temporaryFailures:coverage.missing.length}));
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
