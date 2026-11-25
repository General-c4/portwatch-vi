// Browser fixtures only: no upstream changes, API calls or published fictional stories.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {buildSite} from '../scripts/lib/site-build.mjs';
const root=resolve(process.argv[2]||'_site'),data=JSON.parse(await readFile('data/tracker.json','utf8'));
const story={id:'gemini-news-fixture',date:new Date().toISOString().slice(0,10),category:'Port',title:'Gemini fixture news at 12.5 fps',dek:'A synthetic unverified report.',body:['This test report is unverified and not confirmed.'],sources:[{outlet:'Fixture',url:'https://example.com/news-test',title:'Fixture source'}]};
const ar={title:'خبر تجريبي بمعدل 12.5 إطار/ث',summary:'تقرير تجريبي غير مؤكد.','body.0':'هذا التقرير التجريبي غير موثق ولم يُؤكد.'};
data.news.unshift(story);for(const effort of data.efforts)effort.summary=story.title;
const headline={title:story.title,date:new Date().toISOString(),link:'https://example.com/new-headline',outlet:'Fixture'};data.headlines.unshift(headline);
const fields={title:story.title,summary:story.dek,'body.0':story.body[0]};
const catalog={version:1,articles:{[`article:${story.id}`]:{fields:Object.fromEntries(Object.entries(fields).map(([key,source])=>[key,{source,ar:ar[key]}]))},[`headline:${headline.link}`]:{fields:{title:{source:headline.title,ar:'عنوان إخباري تجريبي'}}}}};
const files=buildSite(data).files;
const server=spawn(process.env.PW_PYTHON||'python',['-m','http.server','8098','--bind','127.0.0.1','--directory',root],{stdio:'ignore',windowsHide:true});
let browser;
try{
 const ready=()=>new Promise(resolve=>{const req=http.get('http://127.0.0.1:8098/',r=>{r.resume();r.on('end',()=>resolve(r.statusCode===200));});req.on('error',()=>resolve(false));});
 for(let i=0;i<30;i++){if(await ready())break;await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:process.env.PW_BROWSER||'msedge',headless:true});
 for(const width of [1920,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  await page.addInitScript(()=>{if(!localStorage.getItem('pw-lang'))localStorage.setItem('pw-lang','ar');});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/assets/js/sync-config.js',r=>r.fulfill({contentType:'text/javascript',body:'export const LIVE_SYNC=false;export const SCORING_HASH="";export const POLL_MS=60000;'}));
  await page.route('**/data/tracker.json',r=>r.fulfill({json:data}));
  await page.route('**/assets/i18n/news/ar.json',r=>r.fulfill({json:catalog}));
  await page.route(/^http:\/\/127\.0\.0\.1:8098\/news\//,r=>{const path=new URL(r.request().url()).pathname.slice(1);return files[path]?r.fulfill({contentType:'text/html',body:files[path]}):r.continue();});
  const base='http://127.0.0.1:8098/';
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
  assert.equal(await page.locator(`[data-story="${story.id}"] h3`).textContent(),ar.title);
  assert.equal(await page.locator(`.headlines a[href="${headline.link}"]`).textContent(),'عنوان إخباري تجريبي');
  assert.equal(await page.locator('.e-summary').first().textContent(),story.title);
  await page.locator(`[data-story="${story.id}"]`).click();await page.waitForSelector('#reader[open]');
  assert.equal(await page.locator('#reader-title').textContent(),ar.title);assert.equal(await page.locator('#reader .article p').textContent(),ar['body.0']);
  assert.equal(await page.locator('#reader .sources a').first().getAttribute('href'),story.sources[0].url);
  await page.goto(base+`news/${story.id}.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(title=>document.querySelector('.reader-page h1')?.textContent===title,ar.title);
  assert.equal(await page.locator('.article p').textContent(),ar['body.0']);assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto(base+'news/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(title=>document.querySelector('.story h3')?.textContent===title,ar.title);
  await page.evaluate(()=>localStorage.setItem('pw-lang','en'));await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
  assert.equal(await page.locator(`[data-story="${story.id}"] h3`).textContent(),story.title);assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Passed scoped news card, feed, modal, article, archive, source links, project isolation and English fallback at desktop/mobile widths.');
}finally{await browser?.close();server.kill();}
