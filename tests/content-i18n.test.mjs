import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contentText,setContentTranslations} from '../assets/js/content-i18n.js';
import {contentInventory} from '../scripts/lib/content-coverage.mjs';
import {buildSite} from '../scripts/lib/site-build.mjs';
import {scoreEffort} from '../assets/js/scoring.js';
import {hash} from '../automation/lib/state.mjs';
import {resolvedLegacyReferences,changeRecordId} from '../assets/js/editorial-scope.js';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const data=await read('../data/tracker.json');
const dict=await read('../assets/i18n/content/ar.json');
test('every current editorial field is translated or durably queued with its exact source hash',async()=>{
 const automatic=await read('../assets/i18n/content/ar.auto.json');
 const scoped=await read('../assets/i18n/news/ar.json');
 const resolved=resolvedLegacyReferences(data,{human:dict,automatic,catalog:scoped});
 const scopedPending=(await read('../automation/state/news-translations.json')).dynamic?.pending||{};
 let queue=[];try{queue=await read('../automation/state/pending-translations.json');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const {path,source} of contentInventory(data)){
  if(typeof (dict[source]??automatic[source])==='string')continue;
  const [section,index,...rest]=path.split('.'),record=data[section]?.[Number(index)];
  const ref=record&&(record.id||record.repo||record.link)?`${section}:${record.id||record.repo||record.link}.${rest.join('.')}`:path;
  if(resolved.has(`${ref}\0${source}`))continue;
  const scopedId=section==='efforts'?`project:${record.id}`:section==='headlines'?`headline:${record.link}`:section==='changes'?changeRecordId(record):null;
  const scopedField=section==='headlines'&&rest.join('.')==='dek'?'summary':rest.join('.');
  if(scopedId&&scopedPending[JSON.stringify([scopedId,scopedField])]?.sourceHash===hash(source))continue;
  assert.ok(queue.some(entry=>entry.scope==='content'&&entry.source===source&&entry.sourceHash===hash(source)),path);
 }
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
