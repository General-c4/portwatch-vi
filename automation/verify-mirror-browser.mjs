import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {verifyParity} from './lib/parity.mjs';
const site=process.env.PW_SITE_URL||'https://general-c4.github.io/portwatch-vi/',official='https://portwatch-vi.xyz/',out=process.env.PW_MIRROR_DIR||'.sync/mirror-browser';
await mkdir(out,{recursive:true});
const get=async url=>{const r=await fetch(url+'?parity='+Date.now());assert(r.ok);return r.json();};
const [source,deployed]=await Promise.all([get(official+'data/tracker.json'),get(site+'data/tracker.json')]);
const parity=verifyParity(source,deployed);
const browser=await chromium.launch({channel:process.env.PW_BROWSER||'msedge',headless:true}),results=[],errors=[];
const rows=page=>page.locator('#race-list>.effort').evaluateAll(els=>els.map(e=>({id:e.id,score:e.querySelector('.e-score b')?.textContent.trim(),nuked:e.classList.contains('is-nuked')})));
try{
 for(const width of [1600,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(()=>{if(!localStorage.getItem('pw-lang'))localStorage.setItem('pw-lang','en');});
  const reference=await context.newPage();await reference.goto(official,{waitUntil:'domcontentloaded'});await reference.waitForSelector('.effort');
  const expected=await rows(reference);assert(expected.some(e=>e.id==='effort-victory-nvidia'));await reference.close();
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(site,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');assert.deepEqual(await rows(page),expected);
  for(const lang of ['ar','en']){
   await page.locator('.lang-btn').click();await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator(`[data-lang="${lang}"]`).click()]);await page.waitForSelector('.effort');
   assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');assert.deepEqual(await rows(page),expected);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${out}/live-${lang}-${width}.png`});
   results.push({width,lang,rankings:expected,filters:await page.locator('.chip[data-filter]').evaluateAll(els=>els.map(e=>e.dataset.filter))});
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(`${out}/report.json`,JSON.stringify({parity,results,errors},null,2));console.log(JSON.stringify({passed:results.length,canonicalParity:parity.latestParity,errors}));
}finally{await browser.close();}
