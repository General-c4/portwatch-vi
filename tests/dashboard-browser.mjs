import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge'});
const results=[];
for(const [width,height] of [[1920,1080],[2560,1440],[768,1024],[390,844],[360,800]]) {
 const page=await browser.newPage({viewport:{width,height},locale:'ar-SA'});
 await page.addInitScript(()=>localStorage.setItem('pw-lang','ar'));
 await page.route('https://esm.sh/**',route=>route.fulfill({contentType:'text/javascript',body:`
 export function createClient(){
 const channel={on(){return channel},subscribe(){return channel}};
 return {auth:{onAuthStateChange(){},async getSession(){return {data:{session:{user:{email:'review@example.test'}}}}}},
 async rpc(name){return {data:name==='claim_admin'?true:name==='admin_live'?{total:42,pages:[]}:{totals:{views_today:100,visitors_today:42},board:{today:0,pending:0}},error:null}},
 from(){return {select(){return this},eq(){return this},order(){return this},async limit(){return {data:[]}}}},channel(){return channel}};
 }` }));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('dashboard/',process.env.PW_BASE_URL || 'http://127.0.0.1:8080/').href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.documentElement.dir==='rtl' && document.querySelector('#tiles')?.children.length===6);
 await page.waitForTimeout(150);
 assert.equal(await page.locator('#pin-publish').textContent(),'نشر');
 assert.equal(await page.locator('#db-status').textContent().then(x=>x.includes('المسؤول')),true);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 await page.screenshot({path:`.local-qa/screenshots/dashboard-ar-${width}.png`,fullPage:true});
 assert.equal(overflow,false,`dashboard overflow at ${width}`);assert.deepEqual(errors,[]);
 results.push({width,overflow,errors,backend:'mocked admin read responses; no writes'});await page.close();
}
await browser.close();await writeFile('.local-qa/dashboard-results.json',JSON.stringify(results,null,2));console.log(results);
