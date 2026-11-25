// Controlled HTTP/browser fixtures: no upstream records are changed.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.PW_FIXTURE_BASE||'http://127.0.0.1:8080/';
const original=JSON.parse(await readFile('data/tracker.json','utf8'));
const pinned=JSON.parse(await readFile('data/pinned.json','utf8'));
const scoring=await readFile('assets/js/scoring.js','utf8');
const scoringHash=createHash('sha256').update(scoring.replace(/\r\n/g,'\n')).digest('hex');
const browser=await chromium.launch({channel:process.env.PW_BROWSER||'msedge'});
const page=await browser.newPage({viewport:{width:390,height:844},locale:'ar-SA'});
let data=structuredClone(original),invalid=false,version=1;
const observations={requests:0,reloads:0,changedAt:null,displayedAt:null};
await page.route('**/assets/js/sync-config.js',route=>route.fulfill({contentType:'text/javascript',body:`export const LIVE_SYNC=true;export const SCORING_HASH='${scoringHash}';export const POLL_MS=1000;`}));
await page.route('https://portwatch-vi.xyz/**',async route=>{
 const url=new URL(route.request().url());observations.requests++;
 if(url.pathname==='/assets/js/scoring.js')return route.fulfill({body:scoring,headers:{'Content-Type':'text/javascript','Access-Control-Allow-Origin':'*'}});
 if(url.pathname==='/data/pinned.json')return route.fulfill({json:pinned,headers:{'Access-Control-Allow-Origin':'*'}});
 if(url.pathname==='/data/tracker.json')return route.fulfill({json:invalid?{}:data,headers:{'Access-Control-Allow-Origin':'*',ETag:`v${version}`,'Access-Control-Expose-Headers':'ETag'}});
 return route.continue();
});
await page.addInitScript(()=>{localStorage.setItem('pw-lang','ar');sessionStorage.setItem('pw_sid','00000100000000000000');});
await page.route('**/api/live',route=>route.fulfill({json:{n:null}}));
page.on('framenavigated',frame=>{if(frame===page.mainFrame())observations.reloads++;});
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
 await page.selectOption('#sort','stars');await page.locator('h1').click();
 const oldReloads=observations.reloads;
 data.updated=new Date(Date.parse(data.updated)+1000).toISOString();
 data.efforts[0].summary='Controlled fixture: changed project summary';data.efforts[0].gta.fps=19;
 data.efforts.push({...structuredClone(data.efforts[0]),id:'fixture-new',name:'Fixture New',repo:'fixture/new',summary:'Controlled fixture: new project'});
 data.tools=data.tools.slice(0,-1);
 data.news.unshift({id:'fixture-news',date:'2026-11-26',category:'Port',title:'Controlled fixture news',dek:'New content',body:['Controlled fixture paragraph'],sources:[]});
 observations.changedAt=Date.now();version++;
 await page.waitForFunction(()=>document.querySelector('[data-story="fixture-news"]'),{},{timeout:15000});
 observations.displayedAt=Date.now();
 assert.ok(observations.reloads>oldReloads);assert.equal(await page.locator('#sort').inputValue(),'stars');
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 await page.locator('[data-story="fixture-news"]').click();assert.equal(await page.locator('#reader-title').textContent(),'Controlled fixture news');await page.keyboard.press('Escape');
 const stable=observations.reloads;invalid=true;version++;await page.waitForTimeout(2500);assert.equal(observations.reloads,stable,'Invalid live data must not trigger a destructive reload');
 assert.equal(await page.locator('[data-story="fixture-news"]').count(),1);
 observations.detectionAndReloadMs=observations.displayedAt-observations.changedAt;observations.testPollMs=1000;observations.productionPollMs=60000;
 await mkdir('.local-qa/sync-evidence',{recursive:true});await writeFile('.local-qa/sync-evidence/live-fixture.json',JSON.stringify(observations,null,2));
 console.log(observations);
}finally{await browser.close();}
