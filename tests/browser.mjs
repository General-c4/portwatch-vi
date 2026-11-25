// Optional end-to-end check: npm install --no-save --package-lock=false playwright
// Build news pages with scripts/preview-build.mjs, serve _site, and set PW_BASE_URL.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {contentText,newsText,editorialText,setContentTranslations,setNewsTranslations} from '../assets/js/content-i18n.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const base=process.env.PW_BASE_URL || 'http://127.0.0.1:8080/';
const baseline=process.env.PW_BASELINE_URL;
const out=process.env.PW_QA_DIR || '.local-qa';
await mkdir(`${out}/screenshots`,{recursive:true});
const data=JSON.parse(await readFile('data/tracker.json','utf8'));
const catalog=JSON.parse(await readFile('assets/i18n/content/ar.json','utf8'));
setContentTranslations({...JSON.parse(await readFile('assets/i18n/content/ar.auto.json','utf8')),...catalog},catalog);
setNewsTranslations(JSON.parse(await readFile('assets/i18n/news/ar.json','utf8')));
const ar=JSON.parse(await readFile('assets/i18n/ar.json','utf8'));
const browser=await chromium.launch({channel:process.env.PW_BROWSER || 'msedge',headless:true});
const results=[],errors=[],resourceFailures=[],consoleErrors=[];
const sizes=[[1920,1080],[2560,1440],[768,1024],[390,844],[360,800]];
async function open(lang,width,height,url=base){
 const context=await browser.newContext({viewport:{width,height},locale:lang==='ar'?'ar-SA':lang,colorScheme:'light'});
 await context.addInitScript(({lang})=>{
   if(!localStorage.getItem('pw-lang'))localStorage.setItem('pw-lang',lang);localStorage.setItem('pw-theme','light');
   // Keep sampled analytics out of the production database during repeated browser checks.
   sessionStorage.setItem('pw_sid','00000100000000000000');
 },{lang});
 await context.route('**/api/live',route=>route.fulfill({json:{n:null}}));
 // Render the committed fixture deterministically; live upstream polling has its own browser test.
 await context.route('**/assets/js/sync-config.js',route=>route.fulfill({contentType:'text/javascript',body:'export const LIVE_SYNC=false;export const SCORING_HASH="";export const POLL_MS=60000;'}));
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push({page:page.url(),text:m.text(),location:m.location()});});
 page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)resourceFailures.push({url:r.url(),status:r.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 return {context,page};
}
async function ready(page){await page.waitForSelector('.effort');await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))]));}
async function capture(page,path){
 await page.locator('details.fold').evaluateAll(els=>els.forEach(e=>e.open=true));
 await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=800){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,5));}window.scrollTo(0,0);});
 await page.waitForTimeout(2000);
 await page.screenshot({path,fullPage:true,animations:'disabled'});
}
try {
 let english;
 for(const lang of ['en','pt-BR','es','ar']) for(const [width,height] of sizes){
  const {context,page}=await open(lang,width,height);await ready(page);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${lang} ${width}: horizontal overflow`);
  const rankings=await page.locator('.effort').evaluateAll(els=>els.map(e=>[e.id,e.querySelector('.e-score b')?.textContent.trim()]));
  if(!english)english=rankings;else assert.deepEqual(rankings,english,`${lang}: scores/rankings`);
  if(lang==='ar'){
   const firstId=(await page.locator('.effort').first().getAttribute('id')).replace(/^effort-/,'');
   assert.equal(await page.locator('.e-summary').first().textContent(),editorialText(data.efforts.find(e=>e.id===firstId).summary,`project:${firstId}`,'summary'));
  }
  await capture(page,`${out}/screenshots/after-${lang}-${width}.png`);
  const filters=[];
  for(const value of ['gta','generic','all']){await page.locator(`[data-filter="${value}"]`).click();filters.push([value,await page.locator('.effort').count()]);}
  for(const value of ['stars','active','score'])await page.selectOption('#sort',value);
  assert.deepEqual(await page.locator('.effort').evaluateAll(els=>els.map(e=>[e.id,e.querySelector('.e-score b')?.textContent.trim()])),english);
  await page.locator('[data-story]').first().click();await page.waitForSelector('#reader[open]');
  if(lang==='ar')assert.equal(await page.locator('#reader-title').textContent(),newsText(data.news[0].title,`article:${data.news[0].id}`,'title'));
  await page.keyboard.press('Escape');assert.equal(await page.locator('#reader').getAttribute('open'),null);
  await page.locator('.lang-btn').click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
  assert.equal(await page.locator('.lang-btn').evaluate(el=>el===document.activeElement),true);
  results.push({page:'home',lang,width,height,filters,rankingsMatch:true,overflow:false,keyboard:true});
  await context.close();
  if(baseline && lang!=='ar'){
   const before=await open(lang,width,height,baseline);await ready(before.page);
   await capture(before.page,`${out}/screenshots/before-${lang}-${width}.png`);await before.context.close();
  }
 }
 // Every canonical article and archive, at every requested size; links retain their original paths.
 for(const [width,height] of sizes){
  const {context,page}=await open('ar',width,height);
  for(const path of ['news/',...data.news.map(n=>`news/${n.id}.html`)]){
   await page.goto(new URL(path,base).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.documentElement.dir==='rtl' && document.querySelector('.lang-btn'));
   await page.waitForTimeout(40);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path);
   const article=data.news.find(n=>path.endsWith(`${n.id}.html`));
   if(article){
    await page.waitForFunction(expected=>document.querySelector('h1')?.textContent===expected,newsText(article.title,`article:${article.id}`,'title'));
    assert.deepEqual(await page.locator('.article p').allTextContents(),article.body.map((p,i)=>newsText(p,`article:${article.id}`,`body.${i}`)));
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),`https://portwatch-vi.xyz/news/${article.id}`);
   }
   results.push({page:path,lang:'ar',width,height,overflow:false});
  }
  await page.screenshot({path:`${out}/screenshots/article-ar-${width}.png`,fullPage:true});await context.close();
 }
 // Real picker selections (not just injected preferences), refresh, and fallback behaviour.
 const {context,page}=await open('en',390,844);await ready(page);
 for(const lang of ['ar','en','pt-BR','es','ar']){
  await page.locator('.lang-btn').click();await Promise.all([page.waitForEvent('load'),page.locator(`[data-lang="${lang}"]`).click()]);await ready(page);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);assert.equal(await page.locator('html').getAttribute('lang'),lang);
 }
 await context.route('**/i18n/content/ar.json',r=>r.fulfill({status:404,body:''}));
 await page.reload({waitUntil:'domcontentloaded'});await ready(page);
 const firstId=(await page.locator('.effort').first().getAttribute('id')).replace(/^effort-/,'');
 assert.equal(await page.locator('.e-summary').first().textContent(),data.efforts.find(e=>e.id===firstId).summary);
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 await context.unroute('**/i18n/content/ar.json');
 await context.route('**/i18n/ar.json',r=>r.fulfill({status:404,body:''}));await page.reload({waitUntil:'domcontentloaded'});await ready(page);
 assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
 await context.close();
 results.push({page:'language switching / persistence / failed catalog fallback',passed:true});
 assert.deepEqual(errors,[]);
 // The final fallback checks intentionally request two missing catalogs.
 const unexpected=resourceFailures.filter(r=>!r.url.endsWith('/i18n/ar.json')&&!r.url.endsWith('/i18n/content/ar.json'));
 assert.deepEqual(unexpected,[]);
 console.log(`Passed ${results.length} browser cases; no uncaught JavaScript errors or unexpected local resource failures.`);
} finally {
 await writeFile(`${out}/browser-results.json`,JSON.stringify({results,errors,resourceFailures,consoleErrors},null,2));await browser.close();
}

