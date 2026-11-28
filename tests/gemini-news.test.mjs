import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeNewsState,syncNews,newsLimits} from '../automation/lib/news-sync.mjs';
import {prepareNewsRequest,validateNewsResponse,newsErrorCode} from '../automation/lib/gemini-news.mjs';
import {contentText,newsText,setContentTranslations,setNewsTranslations} from '../assets/js/content-i18n.js';

const now='2026-11-25T18:00:00Z';
const article=(id='new-story')=>({id,date:'2026-11-25',title:'Leonida Reforge reports 12.5 fps',dek:'An unverified native PC port runs at 12.5 fps.',body:['The project may improve rendering without emulation. Source: https://example.com/report','GTA VI remains a work in progress.'],sources:[{outlet:'Example',url:'https://example.com/report'}]});
const baseline=()=>({news:[{...article('historical'),date:'2026-11-24'}],headlines:[],efforts:[{name:'Unrelated project',summary:'Never send this description'}]});
const translations={
 'Leonida Reforge reports 12.5 fps':'Leonida Reforge يسجل 12.5 fps',
 'An unverified native PC port runs at 12.5 fps.':'نسخة أصلية مخصصة للحاسب الشخصي (PC) غير مؤكدة تعمل بمعدل 12.5 fps.',
 'A verified native PC port runs at 12.5 fps.':'نسخة أصلية مخصصة للحاسب الشخصي (PC) مؤكدة تعمل بمعدل 12.5 fps.',
 'The project may improve rendering without emulation. Source: https://example.com/report':'قد يحسّن المشروع التصيير الرسومي دون المحاكاة. المصدر: https://example.com/report',
 'GTA VI remains a work in progress.':'لا تزال GTA VI قيد التطوير.'
};
function responseFor(request){
 const values={};
 for(const[key,source]of Object.entries(request.fields)){
  let text=translations[source];assert.ok(text,source);
  // Replace each protected occurrence with the exact requested token, as the provider must.
  for(const{token,original}of request.protectedFields[key].tokens)text=text.replace(original,token);
  values[key]=text;
 }
 return {title:values.title||'',summary:values.summary||'',body:Object.entries(values).filter(([k])=>k.startsWith('body.')).map(([k,text])=>({index:Number(k.slice(5)),text})),sourceUrls:request.sourceUrls};
}
const goodClient=calls=>async()=>({model:'gemini-3.8-flash',generate:async request=>{calls.push(request);return{text:JSON.stringify(responseFor(request)),finishReason:'STOP',usage:{promptTokenCount:100,candidatesTokenCount:70,thoughtsTokenCount:10,totalTokenCount:180}};}});
const limits={...newsLimits(),maxInputBytes:60000};
function setup(){const before=baseline(),data={...before,news:[article(),...before.news]};return{before,data,state:initializeNewsState(before,now),now,limits,sleep:async()=>{}};}

test('legacy per-field cooldowns and Gemini-only daily caps cannot freeze a recovered multi-provider router',async()=>{
 const args=setup(),calls=[];
 const blocked=await syncNews({...args,clientFactory:async()=>({model:'test',generate:async()=>{throw Object.assign(new Error('quota'),{status:429});}})});
 blocked.state.pending['article:new-story'].lastError='authentication';blocked.state.daily.requests=999;blocked.state.daily.accountedTokens=999999;
 const factory=goodClient(calls);factory.multiProvider=true;
 const recovered=await syncNews({...args,state:blocked.state,catalog:blocked.catalog,clientFactory:factory});
 assert.equal(recovered.stats.successful,1);assert.equal(calls.length,1);assert.equal(recovered.stats.model,'gemini-3.8-flash');
});

test('an explicit edit translates only changed historical fields, without an archive backfill or duplicate request',async()=>{
 const before=baseline(),data=structuredClone(before),calls=[];
 data.news[0].title='GTA VI remains a work in progress.';
 const result=await syncNews({before:data,data,state:initializeNewsState(before,now),now,limits,sleep:async()=>{},clientFactory:goodClient(calls)});
 assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0].fields),['title']);
 assert.deepEqual(Object.keys(result.catalog.articles['article:historical'].fields),['title']);
 await syncNews({before:data,data,state:result.state,catalog:result.catalog,now,limits,clientFactory:goodClient(calls)});
 assert.equal(calls.length,1);
});
test('a rejected news paragraph does not discard validated siblings or resend them on recovery',async()=>{
 const args=setup(),calls=[];let first=true;
 const factory=async()=>({model:'fixture',generate:async request=>{calls.push(Object.keys(request.fields));const output=responseFor(request);if(first){first=false;output.body[0].text='Untranslated paragraph';}return{text:JSON.stringify(output),finishReason:'STOP',usage:{totalTokenCount:100}};}});factory.multiProvider=true;
 const partial=await syncNews({...args,clientFactory:factory});
 assert.equal(partial.catalog.articles['article:new-story'].fields.title.ar,translations[article().title]);assert.equal(partial.catalog.articles['article:new-story'].fields['body.0'],undefined);assert.equal(partial.stats.pending,1);
 const complete=await syncNews({...args,state:partial.state,catalog:partial.catalog,clientFactory:factory});assert.deepEqual(calls[1],['body.0']);assert.equal(complete.stats.pending,0);
});

test('baseline, history, all non-news and existing reviewed text never reach Gemini',async()=>{
 const setupArgs=setup(),calls=[];setupArgs.data.news.push({...article('old-newly-discovered'),date:'2026-10-01'});
 setupArgs.data.headlines=[{title:'Historical feed item',date:'2026-11-25T17:00:00Z',link:'https://example.com/old'}];
 const result=await syncNews({...setupArgs,human:{[article().title]:'عنوان تمت مراجعته'},clientFactory:goodClient(calls)});
 assert.equal(calls.length,1);assert(!Object.hasOwn(calls[0].fields,'title'));
 assert(!calls[0].prompt.includes('Never send this description'));assert(!calls[0].prompt.includes('Historical feed item'));
 assert(!result.state.eligible['article:historical']);assert(!result.state.eligible['article:old-newly-discovered']);
 assert.equal(result.stats.successful,1);assert.equal(result.stats.inputTokens,100);
});
test('new articles publish separate structured Arabic, cache unchanged fields and only retranslate edits',async()=>{
 const args=setup(),calls=[],clientFactory=goodClient(calls);
 const first=await syncNews({...args,clientFactory});assert.equal(first.stats.successful,1);
 assert.equal(first.catalog.articles['article:new-story'].fields.title.ar,'Leonida Reforge يسجل 12.5 fps');
 assert.equal(first.catalog.articles['article:new-story'].fields['body.0'].source,article().body[0]);assert.deepEqual(args.data.news[0],article());
 const again=await syncNews({...args,state:first.state,catalog:first.catalog,clientFactory});assert.equal(calls.length,1);assert.equal(again.stats.requests,0);assert.equal(again.stats.pending,0);
 const edited=structuredClone(args.data);edited.news[0].dek='A verified native PC port runs at 12.5 fps.';
 const update=await syncNews({...args,data:edited,state:again.state,catalog:again.catalog,clientFactory});
 assert.deepEqual(Object.keys(calls[1].fields),['summary']);assert.equal(update.stats.successful,1);assert.equal(update.catalog.articles['article:new-story'].fields.title.ar,first.catalog.articles['article:new-story'].fields.title.ar);
 const duplicate={...edited,news:[{...article('another-new-story'),dek:edited.news[0].dek},...edited.news]};
 const cached=await syncNews({...args,data:duplicate,state:update.state,catalog:update.catalog,clientFactory});assert.equal(calls.length,2);assert.equal(cached.stats.cachedFields,4);
});
test('structured output rejects omissions, extra fields, invented numbers, damaged links, HTML and altered certainty',()=>{
 const a=article(),request=prepareNewsRequest({title:a.title,summary:a.dek,'body.0':a.body[0]},['https://example.com/report'],['GTA VI']);
 const valid=responseFor(request);assert.match(validateNewsResponse(request,valid).title,/يسجل/);
 const expanded=structuredClone(valid);
 for(const key of ['title','summary'])for(const{token,original}of request.protectedFields[key].tokens)expanded[key]=expanded[key].replace(token,original);
 assert.equal(validateNewsResponse(request,expanded).title,validateNewsResponse(request,valid).title);
 assert.throws(()=>validateNewsResponse(request,'broken'));
 for(const mutate of [o=>delete o.title,o=>o.unexpected='claim',o=>o.sourceUrls=[],o=>o.body=[],o=>o.summary+=' 999',o=>o.title='<script>alert(1)</script>',o=>o.summary='تظل يظل '+o.summary,o=>o.body[0].text=o.body[0].text.replace('قد ','')]){const output=structuredClone(valid);mutate(output);assert.throws(()=>validateNewsResponse(request,output));}
});
test('rate limits persist and automatically retry later without losing English or previous Arabic',async()=>{
 const args=setup(),calls=[];
 const failed=await syncNews({...args,clientFactory:async()=>({model:'test-flash',generate:async()=>{throw Object.assign(new Error('sensitive-provider-body'),{status:429});}})});
 assert.equal(failed.stats.requests,1);assert.equal(failed.stats.pending,1);assert.equal(failed.state.pending['article:new-story'].lastError,'quota_or_rate_limit');
 const early=await syncNews({...args,state:failed.state,catalog:failed.catalog,clientFactory:goodClient(calls)});assert.equal(calls.length,0);
 const retry=await syncNews({...args,now:'2026-11-25T20:00:00Z',state:early.state,catalog:early.catalog,clientFactory:goodClient(calls)});assert.equal(retry.stats.successful,1);assert.equal(retry.stats.pending,0);
 const changed=structuredClone(args.data);changed.news[0].dek='A verified native PC port runs at 12.5 fps.';
 const failure=await syncNews({...args,data:changed,state:retry.state,catalog:retry.catalog,clientFactory:async()=>null});
 assert(failure.catalog.articles['article:new-story'].fields.title);assert(!failure.catalog.articles['article:new-story'].fields.summary);assert.equal(failure.stats.pending,1);
});
test('bounded retries and token/request limits survive restarts and sanitize all provider diagnostics',async()=>{
 const args=setup();
 for(const error of [Object.assign(new Error('SECRET_IN_URL'),{status:401}),Object.assign(new Error('SECRET_IN_URL'),{status:404}),Object.assign(new Error('SECRET_IN_URL'),{status:503}),Object.assign(new Error('SECRET_IN_URL'),{name:'TimeoutError'}),new Error('invalid_json')]){
  const result=await syncNews({...args,clientFactory:async()=>({model:'test-flash',generate:async()=>{throw error;}})});
  assert(result.stats.requests>=1&&result.stats.requests<=2);assert.equal(result.stats.pending,1);assert(!JSON.stringify(result).includes('SECRET_IN_URL'));
 }
 const capped=await syncNews({...args,limits:{...limits,dailyTokens:1},clientFactory:goodClient([])});assert.equal(capped.stats.requests,0);assert.equal(capped.stats.pending,1);
 assert.equal(newsErrorCode({status:403,message:'sensitive'}),'authentication');
});
test('scoped news rendering cannot translate projects or other articles, and human review wins',()=>{
 const source=article().title;
 setContentTranslations({},{});setNewsTranslations({version:1,articles:{'article:new-story':{fields:{title:{source,ar:translations[source]}}}}});
 assert.equal(contentText(source),source);assert.equal(newsText(source,'article:other','title'),source);
 assert.equal(newsText(source,'article:new-story','title'),translations[source]);assert.equal(newsText(source+' changed','article:new-story','title'),source+' changed');
 setContentTranslations({[source]:'ترجمة بشرية'});assert.equal(newsText(source,'article:new-story','title'),'ترجمة بشرية');
 setContentTranslations();setNewsTranslations();
});
