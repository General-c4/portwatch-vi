import {hash} from './state.mjs';
import {dynamicEditorialRecords,editorialCoverage,isTechnicalLiteral,scopedTranslation} from '../../assets/js/editorial-scope.js';
import {protectedTerms} from './translations.mjs';
import {prepareNewsRequest,parseNewsResponse,validateNewsResponse,createGeminiNewsClient,newsErrorCode,NEWS_SYSTEM_INSTRUCTION} from './gemini-news.mjs';
import {newsLimits} from './news-sync.mjs';

export async function syncDynamicEditorial({data,state,catalog,human={},automatic={},clientFactory=createGeminiNewsClient,limits=newsLimits(),now=new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const stateBefore=hash(state),catalogBefore=hash(catalog),started=performance.now();state=structuredClone(state);catalog=structuredClone(catalog);
 if(state.daily.day!==now.slice(0,10))state.daily={day:now.slice(0,10),requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0};
 state.dynamic??={version:1,pending:{},totals:{requests:0,translatedFields:0,failedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0}};
 const d=state.dynamic,stats={requests:0,translatedFields:0,failedFields:0,cachedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0,errors:[]};
 const before=editorialCoverage(data,{human,automatic,catalog});
 const records=dynamicEditorialRecords(data),tasks=[],active=new Set();
 const terms=[...protectedTerms(data),'Bungie','Marvis','Marvisak','Rock Paper Shotgun','Unreal Engine','GDK','DXVK','PSO','RAM','GPU','CPU'];
 // Freeze full hardware identifiers rather than allowing a model to reorder their component words.
 for(const r of records)for(const s of Object.values(r.fields))for(const m of s.matchAll(/(?:Radeon )?RX \d{3,5}(?: XT[X]?)?|(?:GeForce )?RTX \d{3,5}(?: Ti)?|Ryzen \d \d{4,5}[A-Z0-9]*/g))terms.push(m[0]);
 for(const record of records){
  const entry=catalog.articles[record.id]||{fields:{}};entry.fields??={};
  for(const[field,source]of Object.entries(record.fields)){
   const key=JSON.stringify([record.id,field]);active.add(key);
   if(isTechnicalLiteral(source)||Object.hasOwn(human,source)||Object.hasOwn(automatic,source)){delete d.pending[key];continue;}
   if(entry.fields[field]?.source===source){delete d.pending[key];continue;}
   delete entry.fields[field];
   const cached=state.cache[hash(source)];
   if(cached?.source===source&&typeof cached.ar==='string'){entry.fields[field]={source,ar:cached.ar};delete d.pending[key];stats.cachedFields++;continue;}
   if(d.pending[key]?.sourceHash!==hash(source))d.pending[key]={id:record.id,field,sourceHash:hash(source),attempts:0,lastError:null,nextAttemptAt:null};
   const pending=d.pending[key];
   if(!pending.nextAttemptAt||Date.parse(pending.nextAttemptAt)<=Date.parse(now))tasks.push({key,record,field,source,pending});
  }
  if(Object.keys(entry.fields).length)catalog.articles[record.id]=entry;else delete catalog.articles[record.id];
 }
 for(const key of Object.keys(d.pending))if(!active.has(key))delete d.pending[key];
 const makeRequest=items=>{
  const request=prepareNewsRequest(Object.fromEntries(items.map((t,i)=>[`body.${i}`,t.source])),[...new Set(items.flatMap(t=>t.record.sourceUrls))],terms);
  request.prompt+='\nEditorial field context (metadata only): '+JSON.stringify(items.map((t,i)=>({index:i,section:t.record.section,field:t.field})));
  return request;
 };
 let client,stop=false;
 while(tasks.length&&!stop&&stats.requests<limits.maxRequests){
  let batch=[];
  while(tasks.length&&batch.length<6){const next=tasks[0],candidate=[...batch,next];const req=makeRequest(candidate);if(Buffer.byteLength(NEWS_SYSTEM_INSTRUCTION+req.prompt)+1024>limits.maxInputBytes){if(!batch.length){next.pending.lastError='input_limit';tasks.shift();continue;}break;}batch.push(tasks.shift());}
  if(!batch.length)continue;
  if(!client){try{client=await clientFactory({maxOutputTokens:limits.maxOutputTokens});}catch(error){stats.errors.push(newsErrorCode(error));}if(!client){for(const t of batch)t.pending.lastError='provider_unconfigured';break;}}
  stats.model=client.model;
  for(let attempt=0;attempt<2&&batch.length;attempt++){
   const request=makeRequest(batch),reservation=Buffer.byteLength(NEWS_SYSTEM_INSTRUCTION+request.prompt)+1024+limits.maxOutputTokens;
   if(stats.requests>=limits.maxRequests||state.daily.requests>=limits.dailyRequests||state.daily.accountedTokens+reservation>limits.dailyTokens){for(const t of batch)t.pending.lastError='request_or_token_limit';stop=true;break;}
   stats.requests++;d.totals.requests++;state.totals.requests++;state.daily.requests++;state.daily.accountedTokens+=reservation;
   for(const t of batch)t.pending.attempts++;
   let output;
   try{
    const response=await client.generate(request),usage=response.usage||{};
    for(const[key,field]of[['inputTokens','promptTokenCount'],['outputTokens','candidatesTokenCount'],['thinkingTokens','thoughtsTokenCount']])for(const target of[stats,d.totals,state.daily,state.totals])target[key]+=Number(usage[field])||0;
    if(Number.isFinite(usage.totalTokenCount))state.daily.accountedTokens+=Math.max(0,usage.totalTokenCount)-reservation;
    if(!response.text||response.finishReason&&response.finishReason!=='STOP')throw new Error('empty_response');
    output=parseNewsResponse(request,response.text);
   }catch(error){
    const code=newsErrorCode(error);stats.errors.push(code);for(const t of batch)t.pending.lastError=code;
    if(['quota_or_rate_limit','authentication','unsupported_model','invalid_request_or_model'].includes(code))stop=true;
   }
   const failed=[];
   for(const[tIndex,t]of batch.entries()){
    try{
     if(!output)throw Object.assign(new Error('batch_failed'),{safeCode:t.pending.lastError});
     const field=`body.${tIndex}`,single={...request,fields:{[field]:t.source}},part={title:'',summary:'',body:output.body.filter(p=>p.index===tIndex),sourceUrls:output.sourceUrls};
     const ar=validateNewsResponse(single,part)[field];
     catalog.articles[t.record.id]??={fields:{}};catalog.articles[t.record.id].fields[t.field]={source:t.source,ar};
     state.cache[hash(t.source)]={source:t.source,ar,model:client.model};delete d.pending[t.key];stats.translatedFields++;d.totals.translatedFields++;
    }catch(error){
     const code=error.safeCode||newsErrorCode(error);t.pending.lastError=code;stats.failedFields++;d.totals.failedFields++;stats.errors.push(code);
     const delay=['authentication','unsupported_model','invalid_request_or_model'].includes(code)?86400000:code==='quota_or_rate_limit'?3600000:Math.min(86400000,300000*2**Math.min(t.pending.attempts-1,8));
     t.pending.nextAttemptAt=new Date(Date.parse(now)+delay).toISOString();failed.push(t);
    }
   }
   batch=failed;if(stop)break;if(batch.length&&attempt===0&&stats.requests<limits.maxRequests)await sleep(1500);
  }
 }
 for(const t of tasks)t.pending.lastError??=stop?(stats.errors.at(-1)||'request_or_token_limit'):stats.requests>=limits.maxRequests?'request_or_token_limit':'not_attempted';
 stats.errors=[...new Set(stats.errors)];stats.pending=Object.keys(d.pending).length;stats.durationMs=Math.round(performance.now()-started);
 const coverage=editorialCoverage(data,{human,automatic,catalog});
 return{state,catalog,stats,before,coverage,stateChanged:stateBefore!==hash(state),catalogChanged:catalogBefore!==hash(catalog)};
}
