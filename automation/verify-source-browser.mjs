// A staged upstream tree must pass real Arabic/English rendering before a fast-forward is allowed.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import http from 'node:http';
const root=resolve(process.argv[2]||'.');
const child=spawn(process.env.PW_PYTHON||'python',['-m','http.server','8097','--bind','127.0.0.1','--directory',root],{stdio:'ignore',windowsHide:true});
let browser;
try{
 const ready=()=>new Promise(resolve=>{const request=http.get('http://127.0.0.1:8097/',response=>{response.resume();response.on('end',()=>resolve(response.statusCode===200));});request.on('error',()=>resolve(false));});
 for(let i=0;i<30;i++){if(await ready())break;await new Promise(r=>setTimeout(r,200));}
 browser=await chromium.launch({channel:process.env.PW_BROWSER||'msedge',headless:true});
 for(const lang of ['ar','en'])for(const [width,height]of[[1920,1080],[768,1024],[390,844],[360,800]]){
  const context=await browser.newContext({viewport:{width,height},locale:lang==='ar'?'ar-SA':'en-US'}),page=await context.newPage();
  await page.addInitScript(lang=>{localStorage.setItem('pw-lang',lang);sessionStorage.setItem('pw_sid','00000100000000000000');},lang);
  await page.route('**/api/live',route=>route.fulfill({json:{n:null}}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8097/',{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
  assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)console.log({lang,width,offenders:await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>!e.closest('svg')&&(e.getBoundingClientRect().left< -1||e.getBoundingClientRect().right>innerWidth+1)&&getComputedStyle(e).position!=='absolute').slice(-15).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width})))});
  assert.equal(overflow,false,`${lang} ${width}`);
  for(const button of await page.locator('.chip[data-filter]').all())await button.click();
  for(const sort of ['stars','active','score'])await page.selectOption('#sort',sort);
  await page.locator('[data-story]').first().click();await page.waitForSelector('#reader[open]');await page.keyboard.press('Escape');
  if(lang==='ar'&&width===390){
   const text='هذه ترجمة عربية كاملة للرسالة المثبتة دون اقتطاع المحتوى. '.repeat(16);
   const displayed=await page.evaluate(async text=>{const {fillPinned}=await import('./assets/js/pinned.js');fillPinned(document.querySelector('#pinned'),{show:true,name:'Fixture',text},{textLimit:2500});return document.querySelector('#pinned .pin-text').textContent;},text);
   assert.equal(displayed,text.trim());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Passed staged-source Arabic/English browser gate at desktop, tablet and mobile sizes.');
}finally{await browser?.close();child.kill();}
