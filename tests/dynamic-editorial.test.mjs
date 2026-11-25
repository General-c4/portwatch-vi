import test from 'node:test';import assert from 'node:assert/strict';
import {dynamicEditorialRecords,editorialCoverage,changeRecordId,resolvedLegacyReferences} from '../assets/js/editorial-scope.js';
import {initializeNewsState} from '../automation/lib/news-sync.mjs';
import {syncDynamicEditorial} from '../automation/lib/dynamic-editorial.mjs';
import {newsLimits} from '../automation/lib/news-sync.mjs';
import {setContentTranslations,setNewsTranslations,editorialText,contentText} from '../assets/js/content-i18n.js';
import {prepareNewsRequest,googleQuotaInfo} from '../automation/lib/gemini-news.mjs';
import {editorialQualityIssue} from '../assets/js/editorial-quality.js';
const fixture=()=>({news:[{id:'archive',date:'2020-01-01',title:'Never send this archive',body:['Never send this archive body']}],headlines:[{title:'A project reaches 12.5 fps.',link:'https://example.com/headline',date:'2020-01-01',outlet:'Publisher'}],changes:[{date:'2026-11-25',kind:'up',text:'Performance improves to 12.5 fps.'}],efforts:[{id:'alpha',name:'Alpha',tier:'tracked',repo:'dev/alpha',summary:'A project at 12.5 fps.',provenOn:'Small sample games.',highlights:['Rendering works.'],blockers:['Not playable yet.'],target:'GTA VI',gta:{fps:12.5,stability:'often'}},{id:'beta',name:'Beta',tier:'tracked',summary:'Another project runs.',highlights:[],blockers:[]},{id:'gone',tier:'tracked',nuked:{at:'2020-01-01'},summary:'A removed project'}],tools:[{desc:'Unrelated tool'}],candidates:[{description:'Unrelated candidate'}]});
const ar={'A project reaches 12.5 fps.':'مشروع يصل إلى 12.5 fps.','Performance improves to 12.5 fps.':'يتحسن الأداء إلى 12.5 fps.','A project at 12.5 fps.':'مشروع يعمل بمعدل 12.5 fps.','Small sample games.':'ألعاب تجريبية صغيرة.','Rendering works.':'التصيير الرسومي يعمل.','Not playable yet.':'غير قابل للعب بعد.','Another project runs.':'يعمل مشروع آخر.'};
const args=()=>{const data=fixture();return{data,state:initializeNewsState(data),catalog:{version:1,articles:{}},limits:{...newsLimits(),maxRequests:10,dailyTokens:500000,maxInputBytes:30000},sleep:async()=>{}};};
function response(request){return{title:'',summary:'',body:Object.entries(request.fields).map(([key,source])=>{let text=ar[source];assert.ok(text,source);for(const{token,original}of request.protectedFields[key].tokens)text=text.replace(original,token);return{index:Number(key.slice(5)),text};}),sourceUrls:request.sourceUrls};}
const client=calls=>async()=>({model:'gemini-3.6-flash',generate:async req=>{calls.push(req);return{text:JSON.stringify(response(req)),finishReason:'STOP',usage:{promptTokenCount:100,candidatesTokenCount:100,totalTokenCount:200}};}});
test('ordinary hyphenated prose is translated while embedded names, numbers and real identifiers stay protected',()=>{
 const r=prepareNewsRequest({title:'An all-AMD ray-traced 24-Hour build from victory-fork.'},[],['AMD']);
 assert(r.protectedFields.title.text.includes('ray-traced'));assert(!r.protectedFields.title.tokens.some(t=>t.original==='ray-traced'));
 assert(r.protectedFields.title.tokens.some(t=>t.original==='AMD'));assert(r.protectedFields.title.tokens.some(t=>t.original==='24'));assert(r.protectedFields.title.tokens.some(t=>t.original==='victory-fork'));
 assert.equal(editorialQualityIssue('Translates shaders','يترجم مضللات'),'shader_terminology');
 assert.equal(editorialQualityIssue('DMCA campaign','حملة حقوق إلقاء الضوء DMCA'),'dmca_terminology');
 assert.equal(editorialQualityIssue('Ray-traced lighting','إضاءة Ray-traced'),'untranslated_prose');
 assert.equal(editorialQualityIssue('Ray-traced lighting','إضاءة بتتبُّع الأشعة'),null);
});
test('expanded scope includes current old-dated RSS and every active project, excluding historical articles and unrelated records',()=>{
 const data=fixture(),original=JSON.stringify(data),records=dynamicEditorialRecords(data);
 assert(records.some(r=>r.id==='project:alpha'&&r.fields.provenOn));assert(records.some(r=>r.id==='project:beta'));
 assert(records.some(r=>r.id==='headline:https://example.com/headline'));assert(!records.some(r=>/archive|gone|tool|candidate/.test(r.id)));
 assert.equal(JSON.stringify(data),original);
 const old=fixture();old.changes=Array.from({length:13},(_,i)=>({date:'2026-11-25',kind:'up',text:String(i)}));
 assert.equal(dynamicEditorialRecords(old).filter(r=>r.section==='changes').length,12);assert(!dynamicEditorialRecords(old).some(r=>r.id===changeRecordId(old.changes[0])));
});
test('published pinned text is in scope while author, timestamp and links remain canonical',async()=>{
 const a=args(),pinned={show:true,name:'4lwayz',updated:'2026-11-25T18:49:02Z',avatar:'assets/img/author.jpg',text:'Not playable yet.'},original=JSON.stringify(pinned),calls=[];
 const result=await syncDynamicEditorial({...a,pinned,clientFactory:client(calls)});
 assert.equal(result.catalog.articles['pinned:current'].fields.text.ar,ar[pinned.text]);assert.equal(JSON.stringify(pinned),original);
 assert(!calls.some(r=>r.prompt.includes('4lwayz')));assert.equal(result.coverage.sections.pinned.coverage,100);
});
test('quota diagnostics retain safe limits and retry timing, never server messages or credentials',()=>{
 const info=googleQuotaInfo({status:429,message:JSON.stringify({error:{message:'SECRET',details:[{violations:[{quotaId:'RequestsPerMinutePerProject',quotaMetric:'requests',quotaValue:'5',secret:'SECRET'}]},{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'32.5s'}]}})});
 assert.deepEqual(info,{quotas:[{period:'minute',unit:'requests',limit:5}],retryAfterMs:32500});assert(!JSON.stringify(info).includes('SECRET'));
});
test('daily Google retry deadline blocks requests until reset and resumes without resetting counters',async()=>{
 const a=args();a.now='2026-11-25T10:00:00Z';
 a.state.dynamic={version:1,pending:{},totals:{requests:0,translatedFields:0,failedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0},providerBlock:{code:'quota_or_rate_limit',nextAttemptAt:'2026-11-25T11:00:00Z',quota:{quotas:[{period:'day',unit:'requests',limit:20}],retryAfterMs:7200000}}};
 const held=await syncDynamicEditorial({...a,clientFactory:async()=>{throw Error('Must not call provider during cooldown');}});
 assert.equal(held.stats.requests,0);assert.equal(held.stats.blockedUntil,'2026-11-25T12:00:00.000Z');
 const calls=[],resumed=await syncDynamicEditorial({...a,now:'2026-11-25T13:00:00Z',state:held.state,catalog:held.catalog,clientFactory:client(calls)});
 assert.equal(resumed.coverage.missing.length,0);assert.equal(calls.length,2);assert.equal(resumed.state.daily.requests,2);assert.equal(resumed.state.dynamic.providerBlock,undefined);
});
test('backfill validates and batches current dynamic text, preserves numbers/URLs and reaches actual field coverage',async()=>{
 const a=args(),calls=[],original=JSON.stringify(a.data);const result=await syncDynamicEditorial({...a,clientFactory:client(calls)});
 assert.equal(result.coverage.missing.length,0);assert.equal(result.stats.translatedFields,7);assert.equal(calls.length,2);
 assert(!calls.some(r=>r.prompt.includes('Never send this archive')));assert(!calls.some(r=>r.prompt.includes('Unrelated tool')));
 assert.equal(result.catalog.articles['project:alpha'].fields.summary.ar,'مشروع يعمل بمعدل 12.5 fps.');assert.equal(JSON.stringify(a.data),original);
 assert.equal(result.state.daily.inputTokens,200);assert.equal(result.state.daily.requests,2);
 for(const section of Object.values(result.coverage.sections))assert.equal(section.coverage,100);
 const again=await syncDynamicEditorial({...a,state:result.state,catalog:result.catalog,clientFactory:client(calls)});assert.equal(calls.length,2);assert.equal(again.stats.requests,0);
 assert(resolvedLegacyReferences(a.data,{catalog:result.catalog}).has('efforts:alpha.summary\0A project at 12.5 fps.'));
});
test('reviewed fields are never sent, only source edits retranslate, and stable records survive changelog index shifts',async()=>{
 const a=args(),calls=[],human={'A project at 12.5 fps.':'نص بشري'};
 const history=Array.from({length:11},(_,i)=>({date:'2026-11-24',kind:'up',text:`Reviewed old event ${i}`}));for(const c of history)human[c.text]='حدث تمت مراجعته';
 a.data.changes=[...history,...a.data.changes];
 const first=await syncDynamicEditorial({...a,human,clientFactory:client(calls)});
 assert(!calls.some(r=>Object.values(r.fields).includes('A project at 12.5 fps.')));
 a.data.changes.unshift({date:'2020-01-01',kind:'up',text:'Older unrelated history'});
 a.data.efforts[0].summary='Another project runs.';
 const next=await syncDynamicEditorial({...a,state:first.state,catalog:first.catalog,human,clientFactory:client(calls)});
 assert.equal(next.coverage.missing.length,0);assert.equal(next.stats.requests,0);assert(next.stats.cachedFields>0);
 assert.equal(first.catalog.articles['project:alpha'].fields.summary,undefined);
 assert(resolvedLegacyReferences(a.data,{human,catalog:next.catalog}).has('changes.12.text\0Performance improves to 12.5 fps.'));
});
test('one invalid field does not discard validated fields; retry stays bounded and cached successes are not resent',async()=>{
 const a=args(),calls=[];const result=await syncDynamicEditorial({...a,clientFactory:async()=>({model:'gemini-3.6-flash',generate:async req=>{
  calls.push(req);const out=response(req);for(const p of out.body)if(req.fields[`body.${p.index}`]==='Another project runs.')p.text='English prose';
  return{text:JSON.stringify(out),usage:{promptTokenCount:100,candidatesTokenCount:100,totalTokenCount:200}};
 }})});
 assert.equal(result.coverage.missing.length,1);assert.equal(result.coverage.missing[0].id,'project:beta');assert(result.catalog.articles['project:alpha']);
 assert(calls.length<=4);assert.equal(result.state.dynamic.pending[JSON.stringify(['project:beta','summary'])].attempts,2);
 assert(!JSON.stringify(result.catalog).includes('English prose'));
});
test('quota and bad provider errors persist safely without changing canonical data or unrelated reviewed translations',async()=>{
 const a=args(),original=JSON.stringify(a.data);const result=await syncDynamicEditorial({...a,clientFactory:async()=>({model:'gemini-3.6-flash',generate:async()=>{throw Object.assign(new Error('DO_NOT_LEAK_SECRET'),{status:429});}})});
 assert.equal(result.stats.requests,1);assert(result.coverage.missing.length>0);assert(!JSON.stringify(result).includes('DO_NOT_LEAK_SECRET'));assert.equal(JSON.stringify(a.data),original);
 const capped=await syncDynamicEditorial({...a,limits:{...a.limits,dailyTokens:1},clientFactory:client([])});assert.equal(capped.stats.requests,0);
});
test('scoped rendering reaches project fields and changes while unrelated content remains unchanged and English remains available',async()=>{
 const a=args(),result=await syncDynamicEditorial({...a,clientFactory:client([])});setContentTranslations({},{});setNewsTranslations(result.catalog);
 assert.equal(editorialText(a.data.efforts[0].summary,'project:alpha','summary'),ar[a.data.efforts[0].summary]);
 assert.equal(contentText(a.data.efforts[0].summary),a.data.efforts[0].summary);
 setNewsTranslations();assert.equal(editorialText(a.data.efforts[0].summary,'project:alpha','summary'),a.data.efforts[0].summary);
 setContentTranslations();
});
