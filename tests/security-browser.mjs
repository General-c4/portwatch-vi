// Regression: editorial catalogs are plain text and cannot rewrite identifiers or navigation URLs.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=JSON.parse(await readFile('data/tracker.json','utf8'));
const dict=JSON.parse(await readFile('assets/i18n/content/ar.json','utf8'));
const malicious='<img src=x onerror="window.translationExecuted=true">';
const url=`https://github.com/${data.efforts[0].repo}`;
const browser=await chromium.launch({channel:process.env.PW_BROWSER || 'msedge'});
try {
 const page=await browser.newPage({locale:'ar-SA'});
 await page.addInitScript(()=>{localStorage.setItem('pw-lang','ar');sessionStorage.setItem('pw_sid','00000100000000000000');});
 await page.route('**/api/live',r=>r.fulfill({json:{n:null}}));
 await page.route('**/i18n/content/ar.json',r=>r.fulfill({json:{...dict,[data.efforts[0].summary]:malicious,[data.news[0].body[0]]:malicious,[url]:'javascript:window.translationExecuted=true',belobug:'wrong-id'}}));
 const base=process.env.PW_BASE_URL || 'http://127.0.0.1:8080/';
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('.effort');
 assert.equal(await page.locator(`#effort-${data.efforts[0].id} .e-summary`).textContent(),malicious);
 assert.equal(await page.locator('.e-summary img').count(),0);
 assert.equal(await page.locator(`#effort-${data.efforts[0].id} h3 a`).getAttribute('href'),url);
 await page.goto(new URL(`news/${data.news[0].id}.html`,base).href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(value=>document.querySelector('.article p')?.textContent===value,malicious);
 assert.equal(await page.locator('.article p img').count(),0);
 assert.equal(await page.evaluate(()=>window.translationExecuted),undefined);
 console.log('Passed malicious-catalog text, identifier and URL isolation checks.');
}finally{await browser.close();}
