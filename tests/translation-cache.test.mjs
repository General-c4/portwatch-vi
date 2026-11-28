import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncNews,initializeNewsState,newsLimits} from '../automation/lib/news-sync.mjs';
import {syncDynamicEditorial} from '../automation/lib/dynamic-editorial.mjs';
import {hash,withLock,atomicJSON,readJSON} from '../automation/lib/state.mjs';
import {newsText,setNewsTranslations} from '../assets/js/content-i18n.js';
const now='2026-11-28T09:00:00Z',base={news:[],headlines:[],efforts:[]};
const source={title:'A project runs.',summary:'The project improves.',body:'Rendering works.',edited:'The project improves again.'};
const ar={['A project runs.']:'يعمل مشروع.', ['The project improves.']:'يتحسن المشروع.', ['Rendering works.']:'التصيير الرسومي يعمل.', ['The project improves again.']:'يتحسن المشروع مجددًا.'};
const article=id=>({id,date:now,title:source.title,dek:source.summary,body:[source.body],sources:[{url:'https://example.com/news'}]});
const limits={...newsLimits(),maxInputBytes:60000,maxRequests:10};
const args=()=>({before:base,data:{...base,news:[article('one')]},state:initializeNewsState(base,now),now,limits,sleep:async()=>{}});
function factory(calls,provider='gemini'){
 const f=async()=>({model:`${provider}-fixture`,generate:async req=>{
  calls.push(req);const translated=Object.fromEntries(Object.entries(req.fields).map(([k,v])=>{assert(ar[v],v);return[k,ar[v]];}));
  return {text:JSON.stringify({title:translated.title||'',summary:translated.summary||'',body:Object.entries(translated).filter(([k])=>k.startsWith('body.')).map(([k,text])=>({index:Number(k.slice(5)),text})),sourceUrls:req.sourceUrls}),provider,model:`${provider}-fixture`,usage:{promptTokenCount:20,candidatesTokenCount:15,totalTokenCount:35}};
 }});f.multiProvider=true;return f;
}
test('SHA-256 cache metadata persists through JSON restart and provider/model changes; metadata-only sync makes zero calls',async()=>{
 const a=args(),calls=[];const first=await syncNews({...a,clientFactory:factory(calls)});
 const entry=first.state.cache[hash(source.title)];assert.equal(entry.sourceHash,hash(source.title));assert.equal(entry.sourceHash.length,64);
 assert.equal(entry.originalLanguage,'en');assert.equal(entry.targetLanguage,'ar');assert.equal(entry.provider,'gemini');assert.equal(entry.status,'validated');assert.equal(entry.translatedAt,now);
 const ref=Object.values(entry.references)[0];assert.equal(ref.originalContentId,'article:one');assert.equal(ref.fieldHashes.title,hash(source.title));assert.equal(ref.sourceContentHash.length,64);
 const edited=structuredClone(a.data);edited.updated='2030-01-01';edited.news[0].date='2026-11-28T09:30:00Z';edited.news[0].image='new-image.png';edited.news[0].sources=[{url:'https://example.com/changed-url',outlet:'New outlet'}];
 const again=await syncNews({...a,before:a.data,data:edited,state:JSON.parse(JSON.stringify(first.state)),catalog:JSON.parse(JSON.stringify(first.catalog)),clientFactory:factory(calls,'groq')});
 assert.equal(calls.length,1);assert.equal(again.stats.requests,0);assert.equal(again.stats.modifiedItems,0);assert.equal(again.stats.unchangedItems,1);assert.equal(again.stats.cacheHits,3);assert.equal(again.stats.cacheHitPercentage,100);
 assert.equal(again.state.cache[hash(source.title)].provider,'gemini');assert.equal(again.state.cache[hash(source.title)].translatedAt,now);
});
test('multiple new news items share one batch and duplicate field text is sent only once',async()=>{
 const a=args(),calls=[];a.data.news.push(article('two'),article('three'));
 const result=await syncNews({...a,clientFactory:factory(calls)});
 assert.equal(calls.length,1);assert.equal(Object.values(calls[0].fields).length,3);assert.equal(new Set(Object.values(calls[0].fields)).size,3);
 assert.equal(result.stats.deduplicatedFields,6);assert.equal(result.stats.newlyTranslatedFields,9);assert.equal(result.stats.newItems,3);
 for(const id of ['one','two','three'])assert.equal(result.catalog.articles[`article:${id}`].fields.summary.ar,ar[source.summary]);
 const again=await syncNews({...a,state:result.state,catalog:result.catalog,clientFactory:factory(calls,'cloudflare')});assert.equal(calls.length,1);assert.equal(again.stats.pending,0);
});
test('batched distinct titles retain correct article/field ownership and only description edits are resent',async()=>{
 const a=args(),calls=[];a.data.news.push({...article('two'),title:source.edited});
 const first=await syncNews({...a,clientFactory:factory(calls)});
 assert.equal(calls.length,1);assert.equal(Object.keys(calls[0].fields).length,4);
 assert.equal(first.catalog.articles['article:one'].fields.title.ar,ar[source.title]);assert.equal(first.catalog.articles['article:two'].fields.title.ar,ar[source.edited]);
 const data=structuredClone(a.data);data.news[0].dek=source.edited;
 // The changed description already exists as another title: cross-field reuse is zero-call.
 const reused=await syncNews({...a,before:a.data,data,state:first.state,catalog:first.catalog,clientFactory:factory(calls)});
 assert.equal(calls.length,1);assert.equal(reused.stats.modifiedItems,1);assert.equal(reused.stats.cachedFields,1);assert.equal(reused.catalog.articles['article:one'].fields.summary.ar,ar[source.edited]);
});
test('only the edited title is sent; failed edits fall back to source, not stale Arabic, and reuse siblings',async()=>{
 const a=args(),calls=[],first=await syncNews({...a,clientFactory:factory(calls)}),data=structuredClone(a.data);data.news[0].title=source.edited;
 const unavailable=async()=>null;unavailable.multiProvider=true;
 const failed=await syncNews({...a,before:a.data,data,state:first.state,catalog:first.catalog,clientFactory:unavailable});
 assert.equal(failed.catalog.articles['article:one'].fields.title,undefined);assert.equal(failed.catalog.articles['article:one'].fields.summary.ar,ar[source.summary]);assert.equal(failed.stats.pending,1);
 const recovered=await syncNews({...a,before:data,data,state:failed.state,catalog:failed.catalog,clientFactory:factory(calls,'groq')});
 assert.deepEqual(calls[1].fields,{title:source.edited});assert.equal(recovered.stats.cacheMisses,1);assert.equal(recovered.stats.cacheHits,2);assert.equal(recovered.stats.pending,0);
});
test('confirmed deletion removes active catalog, retains 30 days, restores without API; active translations never expire',async()=>{
 const a=args(),calls=[],first=await syncNews({...a,clientFactory:factory(calls)});
 const removed=await syncNews({...a,before:a.data,data:base,state:first.state,catalog:first.catalog,now:'2026-11-29T09:00:00Z',clientFactory:factory(calls)});
 assert.equal(removed.catalog.articles['article:one'],undefined);assert.equal(removed.stats.deletedItems,1);assert(removed.state.cache[hash(source.title)].orphanedAt);
 const restored=await syncNews({...a,state:removed.state,catalog:removed.catalog,now:'2026-12-15T09:00:00Z',clientFactory:factory(calls)});
 assert.equal(calls.length,1);assert.equal(restored.catalog.articles['article:one'].fields.title.ar,ar[source.title]);assert(!restored.state.cache[hash(source.title)].orphanedAt);
 const active=await syncNews({...a,state:restored.state,catalog:restored.catalog,now:'2028-12-15T09:00:00Z',clientFactory:factory(calls)});assert.equal(calls.length,1);assert.equal(active.stats.requests,0);
 const expired=await syncNews({...a,data:base,state:removed.state,catalog:removed.catalog,now:'2026-12-30T09:00:00Z',clientFactory:factory(calls)});assert.equal(expired.stats.expiredEntries,3);assert.equal(Object.keys(expired.state.cache).length,0);
 // Expiry applies even if no workflow ran on day 30 before restoration.
 const late=await syncNews({...a,state:removed.state,catalog:removed.catalog,now:'2026-12-30T09:00:00Z',clientFactory:factory(calls)});assert.equal(late.stats.requests,1);assert.equal(calls.length,2);
});
test('unconfirmed deletion/failing upstream does not retire translations; retention is configurable',async()=>{
 const a=args(),calls=[],first=await syncNews({...a,clientFactory:factory(calls)});
 const uncertain=await syncNews({...a,data:base,state:first.state,catalog:first.catalog,confirmDeletions:false,now:'2026-12-30T09:00:00Z',clientFactory:factory(calls)});
 assert(uncertain.catalog.articles['article:one']);assert(!uncertain.state.cache[hash(source.title)].orphanedAt);assert.equal(uncertain.stats.requests,0);
 const removed=await syncNews({...a,data:base,state:first.state,catalog:first.catalog,now,cacheRetentionDays:1,clientFactory:factory(calls)});
 const cleaned=await syncNews({...a,data:base,state:removed.state,catalog:removed.catalog,now:'2026-11-30T09:00:00Z',cacheRetentionDays:1,clientFactory:factory(calls)});assert.equal(Object.keys(cleaned.state.cache).length,0);
});
test('dynamic duplicate fields in the same batch are translated once and recover all references',async()=>{
 const data={...base,efforts:[{id:'one',tier:'tracked',summary:source.title,highlights:[source.title],blockers:[]},{id:'two',tier:'tracked',summary:source.title,highlights:[],blockers:[]}]},calls=[];
 const result=await syncDynamicEditorial({data,state:initializeNewsState(base,now),catalog:{version:1,articles:{}},now,limits,clientFactory:factory(calls),sleep:async()=>{}});
 assert.equal(calls.length,1);assert.equal(Object.values(calls[0].fields).length,1);assert.equal(result.stats.translatedFields,3);assert.equal(result.stats.deduplicatedFields,2);assert.equal(result.stats.pending,0);
 assert.equal(result.catalog.articles['project:two'].fields.summary.ar,ar[source.title]);
});
test('10,000 visitor render/refresh simulations use static translations and make zero AI or other fetches',async()=>{
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('No request allowed');};
 try{setNewsTranslations({version:1,articles:{'article:one':{fields:{title:{source:source.title,ar:ar[source.title]}}}}});
  for(let i=0;i<10000;i++){if(i%100===0)setNewsTranslations({version:1,articles:{'article:one':{fields:{title:{source:source.title,ar:ar[source.title]}}}}});assert.equal(newsText(source.title,'article:one','title'),ar[source.title]);}
  assert.equal(requests,0);
 }finally{globalThis.fetch=original;setNewsTranslations();}
 // Inspect the entire frontend tree so provider endpoints/credentials cannot enter another route.
 for(const file of await readdir('assets/js',{recursive:true}))if(file.endsWith('.js')){
  const js=await readFile(`assets/js/${file}`,'utf8');assert.doesNotMatch(js,/generativelanguage\.googleapis|api\.groq\.com|api\.z\.ai|api\.cloudflare\.com.*\/ai\/|openrouter\.ai\/api|GEMINI_API_KEY|GROQ_API_KEY|CLOUDFLARE_API_TOKEN|ZAI_API_KEY|automation\/lib\/(?:translation-router|news-sync)/,file);
 }
});
test('overlapping synchronization cannot duplicate a request; the next execution reads the persisted cache',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pw-cache-lock-')),lock=join(directory,'lock'),persisted=join(directory,'checkpoint.json'),a=args(),calls=[];
 let release,started;const ready=new Promise(r=>started=r),held=new Promise(r=>release=r);
 try{
  const first=withLock(lock,async()=>{const result=await syncNews({...a,clientFactory:factory(calls)});await atomicJSON(persisted,result);started();await held;});
  await ready;await assert.rejects(withLock(lock,()=>syncNews({...a,clientFactory:factory(calls)})),/already running/);release();await first;
  const saved=await readJSON(persisted);await withLock(lock,()=>syncNews({...a,state:saved.state,catalog:saved.catalog,clientFactory:factory(calls,'groq')}));assert.equal(calls.length,1);
 }finally{release?.();await rm(directory,{recursive:true,force:true});}
 for(const workflow of ['content-sync.yml','dynamic-backfill.yml','translation-probe.yml']){
  const text=await readFile(`.github/workflows/${workflow}`,'utf8');assert.match(text,/group: mirror-writes\s+cancel-in-progress: false/);
 }
});
