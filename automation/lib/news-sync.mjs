import {hash} from './state.mjs';
import {protectedTerms} from './translations.mjs';
import {createGeminiNewsClient,prepareNewsRequest,parseNewsResponse,validateNewsResponse,newsErrorCode,NEWS_SYSTEM_INSTRUCTION,geminiRetryAt} from './gemini-news.mjs';
import {editorialQualityIssue} from '../../assets/js/editorial-quality.js';
import {contentHash,rememberTranslation,reuseTranslation,reconcileCache,cacheStatistics,retentionDays,hydrateCache} from './translation-cache.mjs';

export function newsRecords(data){
 const articles=(data.news||[]).map(n=>({id:`article:${n.id}`,date:n.date,fields:{title:n.title,summary:n.dek||n.summary||'',...Object.fromEntries((n.body||[]).map((text,i)=>[`body.${i}`,text]))},sourceUrls:(n.sources||[]).map(s=>s.url).filter(Boolean)}));
 const headlines=(data.headlines||[]).filter(n=>typeof n.link==='string'&&/^https:\/\//.test(n.link)&&typeof n.title==='string').map(n=>({id:`headline:${n.link}`,date:n.date,fields:{title:n.title,summary:''},sourceUrls:[n.link]}));
 return [...articles,...headlines];
}
export function initializeNewsState(data,now=new Date().toISOString()){
 return {version:1,activatedAt:now,excludedIds:newsRecords(data).map(n=>n.id),baselineHashes:Object.fromEntries(newsRecords(data).map(r=>[r.id,Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,hash(v)]))])),eligible:{},cache:{},pending:{},daily:{day:now.slice(0,10),requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0},totals:{requests:0,successful:0,failed:0,cachedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0}};
}
const bounded=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
export function newsLimits(env=process.env){
 return {maxRequests:bounded(env.GEMINI_NEWS_MAX_REQUESTS,3,0,10),dailyRequests:bounded(env.GEMINI_NEWS_DAILY_REQUESTS,20,0,100),dailyTokens:bounded(env.GEMINI_NEWS_DAILY_TOKENS,100000,0,500000),maxInputBytes:bounded(env.GEMINI_NEWS_MAX_INPUT_BYTES,24000,1000,60000),maxOutputTokens:bounded(env.GEMINI_NEWS_MAX_OUTPUT_TOKENS,8192,256,16000),maxAttempts:2};
}
const freshStats=()=>({requests:0,inputTokens:0,outputTokens:0,thinkingTokens:0,successful:0,failed:0,cachedFields:0,pending:0,durationMs:0,errors:[]});

// Pure injected boundary for tests; only eligible news fields can reach client.generate.
export async function syncNews({before,data,state,catalog={version:1,articles:{}},human={},clientFactory=createGeminiNewsClient,now=new Date().toISOString(),limits=newsLimits(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),confirmDeletions=true,cacheRetentionDays=retentionDays(),batchItems=4}){
 const started=performance.now(),previousState=hash(state||null),previousCatalog=hash(catalog);
 state=structuredClone(state||initializeNewsState(before,now));catalog=structuredClone(catalog);catalog.articles??={};
 const stats={...freshStats(),cacheHits:0,cacheMisses:0,reusedTranslations:0,newlyTranslatedFields:0,deduplicatedFields:0},excluded=new Set(state.excludedIds),today=now.slice(0,10),work=[];
 if(state.daily.day!==today)state.daily={day:today,requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0};
 let client,clientLoaded=false;
 const terms=protectedTerms(data),records=newsRecords(data);
 hydrateCache(state,catalog,records,{now,days:cacheRetentionDays});
 const previousRecords=new Map(newsRecords(before).map(record=>[record.id,record]));
 state.updatedFields??={};
 for(const record of records){
  if(excluded.has(record.id)){
   const old=previousRecords.get(record.id);
   const baseline=state.baselineHashes?.[record.id];
   const changed=Object.keys(record.fields).filter(field=>baseline?baseline[field]!==hash(record.fields[field]):old&&record.fields[field]!==old.fields[field]);
   const approved=[...new Set([...(state.updatedFields[record.id]||[]),...changed])];
   if(!approved.length)continue;
   state.updatedFields[record.id]=approved;
  }
  if(!state.eligible[record.id]&&!excluded.has(record.id)){
   // A newly discovered historical story is still history, not real-time news.
   if(!/^\d{4}-\d{2}-\d{2}/.test(record.date||'')||record.date.slice(0,10)<state.activatedAt.slice(0,10)||(record.date.length>10&&Date.parse(record.date)<Date.parse(state.activatedAt))||Date.parse(record.date)>Date.parse(now)+86400000){state.excludedIds.push(record.id);excluded.add(record.id);continue;}
   state.eligible[record.id]={firstSeenAt:now};
  }
  const sourceHash=contentHash(record);
  let pending=state.pending[record.id];
  if(pending?.sourceHash!==sourceHash)pending={sourceHash,attempts:0,nextAttemptAt:null,lastError:null};
  const existing=catalog.articles[record.id]||{fields:{}};
  const selected={},nextFields={};
  for(const [key,source]of Object.entries(record.fields)){
   if(excluded.has(record.id)&&!state.updatedFields[record.id].includes(key))continue;
   if(typeof source!=='string'||!source)continue;
   if(Object.hasOwn(human,source)&&typeof human[source]==='string'){stats.cacheHits++;stats.reusedTranslations++;continue;}
   if(existing.fields[key]?.source===source&&typeof existing.fields[key].ar==='string'&&!editorialQualityIssue(source,existing.fields[key].ar)){nextFields[key]=existing.fields[key];rememberTranslation(state,record,key,existing.fields[key].ar,{now});stats.cacheHits++;stats.reusedTranslations++;continue;}
   const cached=reuseTranslation(state,record,key,{now,days:cacheRetentionDays});
   if(cached){nextFields[key]=cached;stats.cachedFields++;stats.cacheHits++;stats.reusedTranslations++;continue;}
   stats.cacheMisses++;
   selected[key]=source;
  }
  // Exact source matching invalidates changed fields but retains unaffected Arabic on failure.
  if(Object.keys(nextFields).length)catalog.articles[record.id]={sourceHash,fields:nextFields};
  else delete catalog.articles[record.id];
  if(!Object.keys(selected).length){delete state.pending[record.id];continue;}
  state.pending[record.id]=pending;
  if(!clientFactory.multiProvider&&pending.nextAttemptAt&&Date.parse(pending.nextAttemptAt)>Date.parse(now))continue;
  const blockedUntil=geminiRetryAt(state);
  if(!clientFactory.multiProvider&&Date.parse(blockedUntil)>Date.parse(now)){pending.lastError='quota_or_rate_limit';pending.nextAttemptAt=blockedUntil;stats.errors.push('quota_or_rate_limit');continue;}
  work.push({record,selected,nextFields,pending,sourceHash});
 }
 // Batch only missing fields. Equal source text is sent once even across articles.
 const makeBatch=items=>{
  const fields={},bySource=new Map(),owners=new Map();let index=0;
  for(const item of items)for(const[key,source]of Object.entries(item.selected)){
   let field=bySource.get(source);
   if(!field){field=items.length===1?key:`body.${index++}`;fields[field]=source;bySource.set(source,field);owners.set(field,[]);}
   owners.get(field).push({item,key});
  }
  const urls=[...new Set(items.flatMap(i=>i.record.sourceUrls))];
  return {request:prepareNewsRequest(fields,urls,terms),owners};
 };
 for(let offset=0;offset<work.length;){
  const items=[work[offset++]];
  while(offset<work.length&&items.length<Math.max(1,Math.min(10,batchItems))){
   const candidate=makeBatch([...items,work[offset]]).request;
   if(Object.keys(candidate.fields).length>20||Buffer.byteLength(NEWS_SYSTEM_INSTRUCTION+candidate.prompt,'utf8')+1024>limits.maxInputBytes)break;
   items.push(work[offset++]);
  }
  // Earlier batches may have translated identical fields. Recheck before sending.
  for(const item of items)for(const[key]of Object.entries(item.selected)){
   const cached=reuseTranslation(state,item.record,key,{now,days:cacheRetentionDays});if(cached){item.nextFields[key]=cached;delete item.selected[key];stats.cacheHits++;stats.cacheMisses--;stats.cachedFields++;stats.reusedTranslations++;}
  }
  const {request,owners}=makeBatch(items),selected=request.fields;
  if(!Object.keys(selected).length){for(const item of items){catalog.articles[item.record.id]={sourceHash:item.sourceHash,fields:item.nextFields};delete state.pending[item.record.id];}continue;}
  stats.deduplicatedFields+=items.reduce((n,i)=>n+Object.keys(i.selected).length,0)-Object.keys(selected).length;
  const mark=code=>{for(const item of items)item.pending.lastError=code;};
  const inputUpperBound=Buffer.byteLength(NEWS_SYSTEM_INSTRUCTION+request.prompt,'utf8')+1024;
  const reservation=inputUpperBound+limits.maxOutputTokens;
  if(inputUpperBound>limits.maxInputBytes){mark('input_limit');continue;}
  if(!clientLoaded){
   clientLoaded=true;
   try{client=await clientFactory({maxOutputTokens:limits.maxOutputTokens});}catch(error){stats.errors.push(newsErrorCode(error));}
  }
  if(!client){mark('provider_unconfigured');continue;}
  stats.model=client.model;
  for(let attempt=0;attempt<limits.maxAttempts;attempt++){
   if(stats.requests>=limits.maxRequests||!clientFactory.multiProvider&&(state.daily.requests>=limits.dailyRequests||state.daily.accountedTokens+reservation>limits.dailyTokens)){mark('request_or_token_limit');break;}
   stats.requests++;state.daily.requests++;state.totals.requests++;state.daily.accountedTokens+=reservation;for(const item of items)item.pending.attempts++;
   let usage;
   try{
    const response=await client.generate(request);
    stats.model=response.model||client.model;stats.provider=response.provider||'gemini';
    usage=response.usage||{};
    const input=Number(usage.promptTokenCount)||0,output=Number(usage.candidatesTokenCount)||0,thinking=Number(usage.thoughtsTokenCount)||0;
    for(const target of [stats,state.daily,state.totals]){target.inputTokens+=input;target.outputTokens+=output;target.thinkingTokens+=thinking;}
    if(Number.isFinite(usage.totalTokenCount))state.daily.accountedTokens+=Math.max(0,usage.totalTokenCount)-reservation;
    if(!response.text||response.finishReason&&response.finishReason!=='STOP')throw new Error('empty_response');
    const parsed=parseNewsResponse(request,response.text),values={};let rejected;
    for(const [key,source]of Object.entries(selected)){
     const part={title:key==='title'?parsed.title:'',summary:key==='summary'?parsed.summary:'',body:key.startsWith('body.')?parsed.body.filter(p=>p.index===Number(key.slice(5))):[],sourceUrls:parsed.sourceUrls};
     try{const ar=validateNewsResponse({...request,fields:{[key]:source}},part)[key];if(editorialQualityIssue(source,ar))throw new Error('protected_facts_or_language_invalid');values[key]=ar;}
     catch(error){rejected??=error;}
    }
    for(const [key,ar]of Object.entries(values))for(const{item,key:originalKey}of owners.get(key)){
     const provenance=response.fieldProvenance?.[key];
     item.nextFields[originalKey]={source:item.selected[originalKey],ar};rememberTranslation(state,item.record,originalKey,ar,{now:provenance?.translatedAt||now,translated:true,provider:provenance?.provider||response.provider||'gemini',model:provenance?.model||response.model||client.model});stats.newlyTranslatedFields++;
    }
    for(const item of items){
     if(Object.keys(item.nextFields).length)catalog.articles[item.record.id]={sourceHash:item.sourceHash,fields:item.nextFields};
     const incomplete=Object.keys(item.selected).some(key=>!item.nextFields[key]);
     if(!incomplete)delete state.pending[item.record.id];
    }
    if(rejected){
     for(const item of items)if(state.pending[item.record.id]){item.pending.lastError=newsErrorCode(rejected);item.pending.nextAttemptAt=new Date(Date.parse(now)+60000).toISOString();}
     stats.failed++;state.totals.failed++;stats.errors.push(newsErrorCode(rejected));stats.partialFields=(stats.partialFields||0)+Object.keys(values).length;break;
    }
    stats.successful+=items.length;state.totals.successful+=items.length;
    break;
   }catch(error){
    const code=newsErrorCode(error);stats.failed++;state.totals.failed++;stats.errors.push(code);mark(code);
    for(const item of items){const delay=Math.min(86400000,300000*2**Math.min(item.pending.attempts-1,8));
    item.pending.nextAttemptAt=new Date(Date.parse(now)+(code==='quota_or_rate_limit'?Math.max(3600000,delay):['authentication','unsupported_model','invalid_request_or_model'].includes(code)?86400000:delay)).toISOString();}
    // Quota/auth/model failures wait persistently; do not hammer them in the same run.
    if(['quota_or_rate_limit','authentication','unsupported_model','invalid_request_or_model','all_free_providers_unavailable'].includes(code))break;
    if(attempt+1<limits.maxAttempts&&stats.requests<limits.maxRequests)await sleep(1000*2**attempt);
   }
  }
 }
 const lifecycle=reconcileCache(state,catalog,records,{now,confirmDeletions,days:cacheRetentionDays,beforeRecords:newsRecords(before)});Object.assign(stats,lifecycle);
 state.totals.cachedFields+=stats.cachedFields;stats.pending=Object.keys(state.pending).length;stats.durationMs=Math.round(performance.now()-started);
 stats.errors=[...new Set(stats.errors)];
 return {state,catalog,stats:cacheStatistics(stats),stateChanged:previousState!==hash(state),catalogChanged:previousCatalog!==hash(catalog)};
}
