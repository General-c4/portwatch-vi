import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contentText,setContentTranslations} from '../assets/js/content-i18n.js';
import {contentInventory} from '../scripts/lib/content-coverage.mjs';
import {buildSite} from '../scripts/lib/site-build.mjs';
import {scoreEffort} from '../assets/js/scoring.js';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const data=await read('../data/tracker.json');
const dict=await read('../assets/i18n/content/ar.json');
test('every current editorial field has an Arabic translation',()=>{
 for(const {path,source} of contentInventory(data))assert.equal(typeof dict[source],'string',path);
});
test('content translations never change canonical data, scores or generated URLs',()=>{
 const original=JSON.stringify(data),scores=data.efforts.map(scoreEffort);
 const baseline=buildSite(data);
 setContentTranslations(dict);
 for(const {source} of contentInventory(data))contentText(source);
 assert.equal(JSON.stringify(data),original);
 assert.deepEqual(data.efforts.map(scoreEffort),scores);
 assert.deepEqual(buildSite(data),baseline);
});
test('missing, changed or malformed translations fall back; inherited properties cannot translate',()=>{
 setContentTranslations(dict);
 assert.equal(contentText('A newly added project'),'A newly added project');
 assert.equal(contentText(data.news[0].title+' updated'),data.news[0].title+' updated');
 assert.equal(contentText('https://github.com/4lwayz/portwatch-vi'),'https://github.com/4lwayz/portwatch-vi');
 setContentTranslations({test:17});assert.equal(contentText('test'),'test');
 setContentTranslations(Object.create({test:'wrong'}));assert.equal(contentText('test'),'test');
 setContentTranslations(null);assert.equal(contentText('test'),'test');
});
