import {hash} from './state.mjs';
import {protectedTerms} from './translations.mjs';
import {createGeminiNewsClient,prepareNewsRequest,validateNewsResponse,newsErrorCode,NEWS_SYSTEM_INSTRUCTION,geminiRetryAt} from './gemini-news.mjs';

export function newsRecords(data){
 const articles=(data.news||[]).map(n=>({id:`article:${n.id}`,date:n.date,fields:{title:n.title,summary:n.dek||n.summary||'',...Object.fromEntries((n.body||[]).map((text,i)=>[`body.${i}`,text]))},sourceUrls:(n.sources||[]).map(s=>s.url).filter(Boolean)}));
 const headlines=(data.headlines||[]).filter(n=>typeof n.link==='string'&&/^https:\/\//.test(n.link)&&typeof n.title==='string').map(n=>({id:`headline:${n.link}`,date:n.date,fields:{title:n.title,summary:''},sourceUrls:[n.link]}));
 return [...articles,...headlines];
}
export function initializeNewsState(data,now=new Date().toISOString()){
 return {version:1,activatedAt:now,excludedIds:newsRecords(data).map(n=>n.id),eligible:{},cache:{},pending:{},daily:{day:now.slice(0,10),requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0},totals:{requests:0,successful:0,failed:0,cachedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0}};
}
const bounded=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
export function newsLimits(env=process.env){
 return {maxRequests:bounded(env.GEMINI_NEWS_MAX_REQUESTS,3,0,10),dailyRequests:bounded(env.GEMINI_NEWS_DAILY_REQUESTS,20,0,100),dailyTokens:bounded(env.GEMINI_NEWS_DAILY_TOKENS,100000,0,500000),maxInputBytes:bounded(env.GEMINI_NEWS_MAX_INPUT_BYTES,24000,1000,60000),maxOutputTokens:bounded(env.GEMINI_NEWS_MAX_OUTPUT_TOKENS,8192,256,16000),maxAttempts:2};
}
const freshStats=()=>({requests:0,inputTokens:0,outputTokens:0,thinkingTokens:0,successful:0,failed:0,cachedFields:0,pending:0,durationMs:0,errors:[]});

// Pure injected boundary for tests; only eligible news fields can reach client.generate.
export async function syncNews({before,data,state,catalog={version:1,articles:{}},human={},clientFactory=createGeminiNewsClient,now=new Date().toISOString(),limits=newsLimits(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const started=performance.now(),previousState=hash(state||null),previousCatalog=hash(catalog);
 state=structuredClone(state||initializeNewsState(before,now));catalog=structuredClone(catalog);catalog.articles??={};
 const stats=freshStats(),excluded=new Set(state.excludedIds),today=now.slice(0,10);
 if(state.daily.day!==today)state.daily={day:today,requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0};
 let client,clientLoaded=false;
 const terms=protectedTerms(data),records=newsRecords(data);
 for(const record of records){
  if(excluded.has(record.id))continue;
  if(!state.eligible[record.id]){
   // A newly discovered historical story is still history, not real-time news.
   if(!/^\d{4}-\d{2}-\d{2}/.test(record.date||'')||record.date.slice(0,10)<state.activatedAt.slice(0,10)||(record.date.length>10&&Date.parse(record.date)<Date.parse(state.activatedAt))||Date.parse(record.date)>Date.parse(now)+86400000){state.excludedIds.push(record.id);excluded.add(record.id);continue;}
   state.eligible[record.id]={firstSeenAt:now};
  }
  const sourceHash=hash({fields:record.fields,sourceUrls:record.sourceUrls});
  let pending=state.pending[record.id];
  if(pending?.sourceHash!==sourceHash)pending={sourceHash,attempts:0,nextAttemptAt:null,lastError:null};
  const existing=catalog.articles[record.id]||{fields:{}};
  const selected={},nextFields={};
  for(const [key,source]of Object.entries(record.fields)){
   if(typeof source!=='string'||!source)continue;
   if(Object.hasOwn(human,source)&&typeof human[source]==='string')continue;
   if(existing.fields[key]?.source===source){nextFields[key]=existing.fields[key];continue;}
   const cached=state.cache[hash(source)];
   if(cached?.source===source&&typeof cached.ar==='string'){nextFields[key]={source,ar:cached.ar};stats.cachedFields++;continue;}
   selected[key]=source;
  }
  // Exact source matching invalidates changed fields but retains unaffected Arabic on failure.
  if(Object.keys(nextFields).length)catalog.articles[record.id]={sourceHash,fields:nextFields};
  else delete catalog.articles[record.id];
  if(!Object.keys(selected).length){delete state.pending[record.id];continue;}
  state.pending[record.id]=pending;
  if(pending.nextAttemptAt&&Date.parse(pending.nextAttemptAt)>Date.parse(now))continue;
  const blockedUntil=geminiRetryAt(state);
  if(Date.parse(blockedUntil)>Date.parse(now)){pending.lastError='quota_or_rate_limit';pending.nextAttemptAt=blockedUntil;stats.errors.push('quota_or_rate_limit');continue;}
  const request=prepareNewsRequest(selected,record.sourceUrls,terms);
  const inputUpperBound=Buffer.byteLength(NEWS_SYSTEM_INSTRUCTION+request.prompt,'utf8')+1024;
  const reservation=inputUpperBound+limits.maxOutputTokens;
  if(inputUpperBound>limits.maxInputBytes){pending.lastError='input_limit';continue;}
  if(!clientLoaded){
   clientLoaded=true;
   try{client=await clientFactory({maxOutputTokens:limits.maxOutputTokens});}catch(error){stats.errors.push(newsErrorCode(error));}
  }
  if(!client){pending.lastError='provider_unconfigured';continue;}
  stats.model=client.model;
  for(let attempt=0;attempt<limits.maxAttempts;attempt++){
   if(stats.requests>=limits.maxRequests||state.daily.requests>=limits.dailyRequests||state.daily.accountedTokens+reservation>limits.dailyTokens){pending.lastError='request_or_token_limit';break;}
   stats.requests++;state.daily.requests++;state.totals.requests++;state.daily.accountedTokens+=reservation;pending.attempts++;
   let usage;
   try{
    const response=await client.generate(request);
    usage=response.usage||{};
    const input=Number(usage.promptTokenCount)||0,output=Number(usage.candidatesTokenCount)||0,thinking=Number(usage.thoughtsTokenCount)||0;
    for(const target of [stats,state.daily,state.totals]){target.inputTokens+=input;target.outputTokens+=output;target.thinkingTokens+=thinking;}
    if(Number.isFinite(usage.totalTokenCount))state.daily.accountedTokens+=Math.max(0,usage.totalTokenCount)-reservation;
    if(!response.text||response.finishReason&&response.finishReason!=='STOP')throw new Error('empty_response');
    const values=validateNewsResponse(request,response.text);
    for(const [key,ar]of Object.entries(values)){nextFields[key]={source:selected[key],ar};state.cache[hash(selected[key])]={source:selected[key],ar,model:client.model};}
    catalog.articles[record.id]={sourceHash,fields:nextFields};delete state.pending[record.id];stats.successful++;state.totals.successful++;
    break;
   }catch(error){
    const code=newsErrorCode(error);stats.failed++;state.totals.failed++;stats.errors.push(code);pending.lastError=code;
    const delay=Math.min(86400000,300000*2**Math.min(pending.attempts-1,8));
    pending.nextAttemptAt=new Date(Date.parse(now)+(code==='quota_or_rate_limit'?Math.max(3600000,delay):['authentication','unsupported_model','invalid_request_or_model'].includes(code)?86400000:delay)).toISOString();
    // Quota/auth/model failures wait persistently; do not hammer them in the same run.
    if(['quota_or_rate_limit','authentication','unsupported_model','invalid_request_or_model'].includes(code))break;
    if(attempt+1<limits.maxAttempts&&stats.requests<limits.maxRequests)await sleep(1000*2**attempt);
   }
  }
 }
 state.totals.cachedFields+=stats.cachedFields;stats.pending=Object.keys(state.pending).length;stats.durationMs=Math.round(performance.now()-started);
 stats.errors=[...new Set(stats.errors)];
 return {state,catalog,stats,stateChanged:previousState!==hash(state),catalogChanged:previousCatalog!==hash(catalog)};
}
