import {hash} from './state.mjs';
import {dynamicEditorialRecords,editorialCoverage,isTechnicalLiteral,scopedTranslation} from '../../assets/js/editorial-scope.js';
import {protectedTerms} from './translations.mjs';
import {prepareNewsRequest,parseNewsResponse,validateNewsResponse,createGeminiNewsClient,newsErrorCode,googleQuotaInfo,NEWS_SYSTEM_INSTRUCTION} from './gemini-news.mjs';
import {newsLimits} from './news-sync.mjs';
import {editorialQualityIssue} from '../../assets/js/editorial-quality.js';
const SYSTEM=NEWS_SYSTEM_INSTRUCTION+`\nيشمل العمل عناوين الأخبار وتحديثات المشاريع ووصف أدائها واختباراتها، لا المقالات فقط. راجع الترجمة جملة بجملة، دون حذف أو اختصار أو إضافة ادعاءات. برامج shaders هي برامج التظليل وليست مضللات. Vertex shaders: برامج تظليل الرؤوس. Texture streaming: بث الخامات. Compatibility layer: طبقة توافق. Ray-traced lighting: الإضاءة بتتبع الأشعة. Retail game: النسخة التجارية من اللعبة. DMCA: قانون حقوق المؤلف وإشعارات الإزالة؛ ليس إلقاء الضوء. Vibecoders: المبرمجون بمساعدة الذكاء الاصطناعي. النسب المئوية في تحديثات ترتيب المشاريع درجات تقدّم وليست معدلات إطارات. احتفظ بالتعليقات والقيود والسخرية إن وردت في العنوان. حافظ على نسبة الادعاءات إلى تقرير المشروع ولا تعرضها كتأكيد مستقل. اسم الحساب ليس منصة جديدة: حساب Zettrox يخص GitHub ولا تنسبه إلى منصة اسمها Zettrox. sourceUrls هنا معرّفات مراجع محمية وليست روابط قابلة لإعادة الكتابة؛ أعدها حرفيًا. راجع سلامة الأرقام والمصطلحات والنحو قبل الإخراج.`;

export async function syncDynamicEditorial({data,pinned,state,catalog,human={},automatic={},clientFactory=createGeminiNewsClient,limits=newsLimits(),now=new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{},batchFields=Math.max(1,Math.min(20,Number(process.env.GEMINI_EDITORIAL_BATCH_FIELDS)||6)),requestIntervalMs=13000}){
 const stateBefore=hash(state),catalogBefore=hash(catalog),started=performance.now();state=structuredClone(state);catalog=structuredClone(catalog);
 if(state.daily.day!==now.slice(0,10))state.daily={day:now.slice(0,10),requests:0,accountedTokens:0,inputTokens:0,outputTokens:0,thinkingTokens:0};
 state.dynamic??={version:1,pending:{},totals:{requests:0,translatedFields:0,failedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0}};
 const d=state.dynamic,stats={requests:0,translatedFields:0,failedFields:0,cachedFields:0,inputTokens:0,outputTokens:0,thinkingTokens:0,errors:[]};
 // Upgrade the initial one-hour fallback to Google's actual daily-quota RetryInfo deadline.
 if(d.providerBlock?.quota?.quotas.some(q=>q.period==='day')&&d.providerBlock.quota.retryAfterMs>3600000&&!d.providerBlock.blockedAt){
  d.providerBlock.blockedAt=new Date(Date.parse(d.providerBlock.nextAttemptAt)-3600000).toISOString();
  d.providerBlock.nextAttemptAt=new Date(Date.parse(d.providerBlock.blockedAt)+d.providerBlock.quota.retryAfterMs).toISOString();
 }
 const before=editorialCoverage(data,{human,automatic,catalog},pinned);
 const records=dynamicEditorialRecords(data,pinned),tasks=[],active=new Set();
 const terms=[...protectedTerms(data),'Bungie','Marvis','Marvisak','Rock Paper Shotgun','Unreal Engine','GDK','DXVK','PSO','RAM','GPU','CPU','Arion Kurtaj','Minecraft Preview','Unicorn Overlord','Concept Destruction','The Matrix Awakens','Trackmania','Terraria','Fortnite','Freedoom','Unicorn','Wine','Scarlett','VIctory'];
 // Freeze full hardware identifiers rather than allowing a model to reorder their component words.
 for(const r of records)for(const s of Object.values(r.fields))for(const m of s.matchAll(/(?:Radeon )?RX \d{3,5}(?: XT[X]?)?|(?:GeForce )?RTX \d{3,5}(?: Ti)?|Ryzen \d \d{4,5}[A-Z0-9]*/g))terms.push(m[0]);
 for(const r of records)for(const s of Object.values(r.fields))for(const m of s.matchAll(/([A-Za-z0-9_.-]+)'s\s+([a-z][A-Za-z0-9_.-]*(?:-[A-Za-z0-9_.-]+)+)|\b[A-Z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b/g))terms.push(...(m[1]?[m[1],m[2]]:[m[0]]));
 for(const record of records){
  const entry=catalog.articles[record.id]||{fields:{}};entry.fields??={};
  for(const[field,source]of Object.entries(record.fields)){
   const key=JSON.stringify([record.id,field]);active.add(key);
   if(isTechnicalLiteral(source)||Object.hasOwn(human,source)||Object.hasOwn(automatic,source)){delete d.pending[key];continue;}
   if(entry.fields[field]?.source===source&&typeof entry.fields[field].ar==='string'&&!editorialQualityIssue(source,entry.fields[field].ar)){delete d.pending[key];continue;}
   delete entry.fields[field];
   const cached=state.cache[hash(source)];
   if(cached?.source===source&&typeof cached.ar==='string'&&!editorialQualityIssue(source,cached.ar)){entry.fields[field]={source,ar:cached.ar};delete d.pending[key];stats.cachedFields++;continue;}
   if(d.pending[key]?.sourceHash!==hash(source))d.pending[key]={id:record.id,field,sourceHash:hash(source),attempts:0,lastError:null,nextAttemptAt:null};
   const pending=d.pending[key];
   if(!pending.nextAttemptAt||Date.parse(pending.nextAttemptAt)<=Date.parse(now))tasks.push({key,record,field,source,pending});
  }
  if(Object.keys(entry.fields).length)catalog.articles[record.id]=entry;else delete catalog.articles[record.id];
 }
 for(const key of Object.keys(d.pending))if(!active.has(key))delete d.pending[key];
 const makeRequest=items=>{
  // Keep original URLs in canonical data. Echo short opaque reference IDs instead of huge RSS URLs.
  const refs=[...new Set(items.flatMap(t=>t.record.sourceUrls))].map((_,i)=>`PW_SOURCE_${i}`);
  const request=prepareNewsRequest(Object.fromEntries(items.map((t,i)=>[`body.${i}`,t.source])),refs,terms);
  request.prompt+='\nEditorial field context (metadata only): '+JSON.stringify(items.map((t,i)=>({index:i,section:t.record.section,field:t.field,priorValidationError:t.pending.lastError})));
  return request;
 };
 let client,stop=Date.parse(d.providerBlock?.nextAttemptAt||'')>Date.parse(now),lastRequestAt=0;
 if(stop){stats.errors.push(d.providerBlock.code);stats.quota=d.providerBlock.quota;stats.blockedUntil=d.providerBlock.nextAttemptAt;for(const t of tasks)t.pending.lastError=d.providerBlock.code;}
 while(tasks.length&&!stop&&stats.requests<limits.maxRequests){
  let batch=[];
  while(tasks.length&&batch.length<batchFields){const next=tasks[0],candidate=[...batch,next];const req=makeRequest(candidate);if(Buffer.byteLength(SYSTEM+req.prompt)+1024>limits.maxInputBytes){if(!batch.length){next.pending.lastError='input_limit';tasks.shift();continue;}break;}batch.push(tasks.shift());}
  if(!batch.length)continue;
  if(!client){try{client=await clientFactory({maxOutputTokens:limits.maxOutputTokens,thinkingLevel:'MEDIUM',timeoutMs:90000,systemInstruction:SYSTEM});}catch(error){stats.errors.push(newsErrorCode(error));}if(!client){for(const t of batch)t.pending.lastError='provider_unconfigured';break;}}
  stats.model=client.model;
  for(let attempt=0;attempt<2&&batch.length;attempt++){
   const request=makeRequest(batch),reservation=Buffer.byteLength(SYSTEM+request.prompt)+1024+limits.maxOutputTokens;
   if(stats.requests>=limits.maxRequests||state.daily.requests>=limits.dailyRequests||state.daily.accountedTokens+reservation>limits.dailyTokens){for(const t of batch)t.pending.lastError='request_or_token_limit';stop=true;break;}
   await sleep(Math.max(0,requestIntervalMs-(Date.now()-lastRequestAt)));lastRequestAt=Date.now();
   stats.requests++;d.totals.requests++;state.totals.requests++;state.daily.requests++;state.daily.accountedTokens+=reservation;
   for(const t of batch)t.pending.attempts++;
   let output;
   try{
    const response=await client.generate(request),usage=response.usage||{};
    delete d.providerBlock;
    for(const[key,field]of[['inputTokens','promptTokenCount'],['outputTokens','candidatesTokenCount'],['thinkingTokens','thoughtsTokenCount']])for(const target of[stats,d.totals,state.daily,state.totals])target[key]+=Number(usage[field])||0;
    if(Number.isFinite(usage.totalTokenCount))state.daily.accountedTokens+=Math.max(0,usage.totalTokenCount)-reservation;
    if(!response.text||response.finishReason&&response.finishReason!=='STOP')throw new Error('empty_response');
    output=parseNewsResponse(request,response.text);
   }catch(error){
    const code=newsErrorCode(error);stats.errors.push(code);for(const t of batch)t.pending.lastError=code;
    if(code==='quota_or_rate_limit'){
     const quota=googleQuotaInfo(error);stats.quota=quota;const daily=quota?.quotas.some(q=>q.period==='day');
     const blockedAt=Date.parse(now)+Math.round(performance.now()-started),delay=Math.max(daily?3600000:60000,quota?.retryAfterMs||0);
     d.providerBlock={code,blockedAt:new Date(blockedAt).toISOString(),nextAttemptAt:new Date(blockedAt+delay).toISOString(),quota};
    }
    if(['quota_or_rate_limit','authentication','unsupported_model','invalid_request_or_model'].includes(code))stop=true;
   }
   const failed=[];
   for(const[tIndex,t]of batch.entries()){
    try{
     if(!output)throw Object.assign(new Error('batch_failed'),{safeCode:t.pending.lastError});
     const field=`body.${tIndex}`,single={...request,fields:{[field]:t.source}},part={title:'',summary:'',body:output.body.filter(p=>p.index===tIndex),sourceUrls:output.sourceUrls};
     const ar=validateNewsResponse(single,part)[field];
     const issue=editorialQualityIssue(t.source,ar);if(issue)throw Object.assign(new Error('editorial_quality'),{safeCode:issue});
     catalog.articles[t.record.id]??={fields:{}};catalog.articles[t.record.id].fields[t.field]={source:t.source,ar};
     state.cache[hash(t.source)]={source:t.source,ar,model:client.model};delete d.pending[t.key];stats.translatedFields++;d.totals.translatedFields++;
    }catch(error){
     const code=error.safeCode||newsErrorCode(error);t.pending.lastError=code;stats.failedFields++;d.totals.failedFields++;stats.errors.push(code);
     const eventTime=Date.parse(now)+Math.round(performance.now()-started);
     const delay=['authentication','unsupported_model','invalid_request_or_model'].includes(code)?86400000:code==='quota_or_rate_limit'?Math.max(60000,Date.parse(d.providerBlock?.nextAttemptAt||'')-eventTime||60000):Math.min(86400000,300000*2**Math.min(t.pending.attempts-1,8));
     t.pending.nextAttemptAt=new Date(eventTime+delay).toISOString();failed.push(t);
    }
   }
   batch=failed;onProgress({requests:stats.requests,translatedFields:stats.translatedFields,failedFields:stats.failedFields,remainingInBatch:batch.length});if(stop)break;if(batch.length&&attempt===0&&stats.requests<limits.maxRequests)await sleep(1500);
  }
 }
 for(const t of tasks)t.pending.lastError??=stop?(stats.errors.at(-1)||'request_or_token_limit'):stats.requests>=limits.maxRequests?'request_or_token_limit':'not_attempted';
 stats.errors=[...new Set(stats.errors)];stats.pending=Object.keys(d.pending).length;stats.durationMs=Math.round(performance.now()-started);
 const coverage=editorialCoverage(data,{human,automatic,catalog},pinned);
 return{state,catalog,stats,before,coverage,stateChanged:stateBefore!==hash(state),catalogChanged:catalogBefore!==hash(catalog)};
}
