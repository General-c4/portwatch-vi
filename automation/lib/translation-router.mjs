import {readJSON,atomicJSON} from './state.mjs';
import {createGeminiNewsClient,NEWS_SYSTEM_INSTRUCTION,NEWS_RESPONSE_SCHEMA,validateNewsResponse,newsErrorCode,googleQuotaInfo,geminiRetryAt} from './gemini-news.mjs';
import {editorialQualityIssue} from '../../assets/js/editorial-quality.js';

const POLICY={
 gemini:{key:'GEMINI_API_KEY',models:['gemini-3.6-flash']},
 groq:{key:'GROQ_API_KEY',url:'https://api.groq.com/openai/v1/chat/completions',models:['qwen/qwen3.8-27b','openai/gpt-oss-120b']},
 cloudflare:{key:'CLOUDFLARE_API_TOKEN',models:['@cf/meta/llama-3.3-70b-instruct-fp8-fast','@cf/mistralai/mistral-small-3.1-24b-instruct']},
 zai:{key:'ZAI_API_KEY',url:'https://api.z.ai/api/paas/v4/chat/completions',models:['glm-4.7-flash']},
 axforge:{key:'AXFORGE_API_KEY',url:'https://api.axforge.ai/v1/chat/completions',models:['qwen3.8-27b']},
 openrouter:{key:'OPENROUTER_API_KEY',url:'https://openrouter.ai/api/v1/chat/completions',models:['google/gemma-4-26b-a4b-it:free','google/gemma-4-31b-it:free']},
 ovh:{anonymous:true,url:'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',models:['Qwen3.8-27B','gpt-oss-120b']},
};
export const FREE_PROVIDER_IDS=Object.keys(POLICY);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function retryDelay(value,now=Date.now()){
 if(!value)return 0;
 if(/^\d+(\.\d+)?$/.test(value)){const n=Number(value);return n>1e12?Math.max(0,n-now):n>1e9?Math.max(0,n*1000-now):n*1000;}
 if(/^(?:\d+(?:\.\d+)?[hms])+$/.test(value))return [...value.matchAll(/(\d+(?:\.\d+)?)([hms])/g)].reduce((n,m)=>n+Number(m[1])*({h:3600000,m:60000,s:1000}[m[2]]),0);
 return Math.max(0,Date.parse(value)-now)||0;
}
export function freePolicy(id,model,env=process.env){
 const p=POLICY[id];
 if(!p||!p.models.includes(model))return false;
 if(p.anonymous)return true; // No account, key, billing identity or authenticated fallback exists.
 // Explicit account-level assurance is required; a model allowlist cannot prove billing settings.
 const verified=(env.TRANSLATION_FREE_PROVIDERS||'gemini').split(',').map(s=>s.trim());
 return verified.includes(id)&&Boolean(env[p.key])&&(id!=='cloudflare'||/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''));
}
function dayKey(id,time){return id==='gemini'?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time)):new Date(time).toISOString().slice(0,10);}
function dailyReset(id,time){
 const key=dayKey(id,time);let next=time+60000;
 // Handles Pacific daylight-saving changes without assuming a fixed UTC offset.
 while(dayKey(id,next)===key)next+=60000;return next;
}
export async function createTranslationRouter({root='.',config,state,env=process.env,fetchImpl=fetch,clock=Date.now,sleep=wait,clientFactories={},onCandidate=()=>{}}={}){
 config??=await readJSON(`${root}/automation/translation-providers.json`);
 state??=await readJSON(`${root}/automation/state/translation-providers.json`,{version:1,providers:{},events:[]});
 state.providers??={};state.events??=[];let attempts=0;
 const legacy=await readJSON(`${root}/automation/state/news-translations.json`,{}),legacyRetry=Date.parse(geminiRetryAt(legacy));
 if(legacyRetry>clock())state.providers.gemini={...(state.providers.gemini||{}),cooldownUntil:Math.max(state.providers.gemini?.cooldownUntil||0,legacyRetry),code:'quota_or_rate_limit'};
 const event=(type,fields)=>{const entry={at:new Date(clock()).toISOString(),type,...fields,costUSD:0};state.events.push(entry);state.events=state.events.slice(-100);return entry;};
 const save=()=>atomicJSON(`${root}/automation/state/translation-providers.json`,state);
 const ordered=()=>config.order.filter(id=>config.providers[id]).sort((a,b)=>{
  const score=id=>{if(id===config.primary)return -1000;const p=state.providers[id]||{},quality=Number.isFinite(config.providers[id].reviewedArabicQuality)?config.providers[id].reviewedArabicQuality:0;return config.order.indexOf(id)*10+(p.failures||0)/Math.max(1,p.requests||0)*10+Math.min(5,(p.latencyMs||0)/10000)-quality/20;};
  return score(a)-score(b);
 });
 const clientFactory=async(options={})=>{
  let lastModel='unavailable';
  return {get model(){return lastModel;},generate:async request=>{
   const eligible=ordered();let tried=0;
   for(const id of eligible){
    const policy=POLICY[id],settings=config.providers[id],model=settings.model;
    if(!freePolicy(id,model,env)){event('disabled',{provider:id,reason:'missing_credentials_or_free_account_assurance'});continue;}
    const now=clock(),p=state.providers[id]??={};
    for(const key of ['requests','successes','failures'])if(!Number.isFinite(p[key]))p[key]=0;
    const day=dayKey(id,now);if(p.daily?.day!==day)p.daily={day,requests:0,tokens:0};
    if(p.monthly?.resetAt&&now>=p.monthly.resetAt)delete p.monthly;
    p.monthly??={resetAt:now+30*86400000,tokens:0};
    if(p.cooldownUntil>now){event('cooldown_skip',{provider:id,code:p.code,resetAt:new Date(p.cooldownUntil).toISOString()});continue;}
    const outputLimit=id==='groq'?Math.min(2048,options.maxOutputTokens||8192):options.maxOutputTokens||8192;
    const instructions=(options.systemInstruction||NEWS_SYSTEM_INSTRUCTION)+'\nReturn exactly this JSON schema, with every required property and no other properties: '+JSON.stringify(NEWS_RESPONSE_SCHEMA);
    const reserve=Buffer.byteLength(instructions+request.prompt)+1024+outputLimit;
    if(settings.dailyRequests&&p.daily.requests>=settings.dailyRequests||settings.dailyTokens&&p.daily.tokens+reserve>settings.dailyTokens){p.cooldownUntil=dailyReset(id,now);p.code='local_daily_limit';event('quota',{provider:id,resetAt:new Date(p.cooldownUntil).toISOString()});continue;}
    if(settings.monthlyTokens&&p.monthly.tokens+reserve>settings.monthlyTokens){p.cooldownUntil=p.monthly.resetAt;p.code='local_monthly_limit';continue;}
    if(attempts>=config.maxAttemptsPerRun)break;
    // TPM reservations protect short windows even when a response omits usage.
    if(!p.minute||now>=p.minute.resetAt)p.minute={resetAt:now+60000,tokens:0};
    if(settings.tokensPerMinute&&reserve>settings.tokensPerMinute){event('input_too_large',{provider:id});continue;}
    if(settings.tokensPerMinute&&p.minute.tokens+reserve>settings.tokensPerMinute){p.cooldownUntil=p.minute.resetAt;p.code='local_minute_limit';continue;}
    await sleep(Math.max(0,(p.lastRequestAt||0)+(settings.intervalMs||0)-clock()));
    attempts++;tried++;p.requests++;p.daily.requests++;p.daily.tokens+=reserve;p.monthly.tokens+=reserve;p.minute.tokens+=reserve;p.lastRequestAt=clock();
    // Persist the reservation before sending. A terminated workflow cannot spend the same budget twice.
    await save();const started=clock();
    try{
     let response;
     if(clientFactories[id])response=await(await clientFactories[id]({...options,model})).generate(request);
     else if(id==='gemini')response=await(await createGeminiNewsClient({...options,model,apiKey:env.GEMINI_API_KEY})).generate(request);
     else{
      if(id==='openrouter'){
       const catalog=await fetchImpl('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(10000)});if(!catalog.ok)throw new Error('free_price_unverified');
       const info=(await catalog.json()).data?.find(m=>m.id===model);
       if(!info||Number(info.pricing?.prompt)!==0||Number(info.pricing?.completion)!==0||!model.endsWith(':free'))throw new Error('free_price_unverified');
      }
      const url=id==='cloudflare'?`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`:policy.url;
      const max=outputLimit;
      const body={model,messages:[{role:'system',content:instructions},{role:'user',content:request.prompt}],max_tokens:max,temperature:0.1,response_format:{type:'json_object'}};
      if(id==='openrouter')body.provider={max_price:{prompt:0,completion:0},allow_fallbacks:false};
      const result=await fetchImpl(url,{method:'POST',redirect:'error',headers:{...(!policy.anonymous?{Authorization:`Bearer ${env[policy.key]}`}:{ }),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs||45000)});
      if(!result.ok){
       const error=Object.assign(new Error('provider_http'),{status:result.status});
       error.retryMs=retryDelay(result.headers.get('retry-after'),clock());error.dailyResetMs=retryDelay(result.headers.get('x-ratelimit-reset-requests'),clock());error.minuteResetMs=retryDelay(result.headers.get('x-ratelimit-reset-tokens'),clock());
       // Inspect privately for quota classification; never persist or log the response body.
       const detail=JSON.stringify(await result.json().catch(()=>null));
       if(result.status===429&&(result.headers.get('x-ratelimit-remaining-requests')==='0'||/daily|per.?day|neurons/i.test(detail)&&id==='cloudflare'))error.quotaPeriod='day';
       if(result.status===429&&/monthly|per.?month/i.test(detail))error.quotaPeriod='month';
       throw error;
      }
      const json=await result.json(),choice=json.choices?.[0],usage=json.usage||{};
      response={text:choice?.message?.content,finishReason:choice?.finish_reason==='stop'?'STOP':choice?.finish_reason,usage:{...(Number.isFinite(usage.prompt_tokens)?{promptTokenCount:usage.prompt_tokens}:{}),...(Number.isFinite(usage.completion_tokens)?{candidatesTokenCount:usage.completion_tokens}:{}),...(Number.isFinite(usage.total_tokens)?{totalTokenCount:usage.total_tokens}:{})}};
     }
     const usage=response.usage||{},total=usage.totalTokenCount;
     onCandidate({provider:id,text:response.text,finishReason:response.finishReason});
     if(Number.isFinite(total))for(const bucket of [p.daily,p.monthly,p.minute])bucket.tokens+=Math.max(0,total)-reserve;
     if(!response.text||response.finishReason&&response.finishReason!=='STOP')throw new Error('empty_response');
     const fields=validateNewsResponse(request,response.text);
     for(const[key,value]of Object.entries(fields))if(editorialQualityIssue(request.fields[key],value))throw new Error('protected_facts_or_language_invalid');
     p.successes++;p.failureStreak=0;p.cooldownUntil=0;p.code=null;p.latencyMs=clock()-started;lastModel=`${id}/${model}`;
     const safeUsage=Object.fromEntries(Object.entries(usage).filter(([key,value])=>['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount'].includes(key)&&Number.isFinite(value)));
     event('success',{provider:id,model,latencyMs:p.latencyMs,usage:Object.keys(safeUsage).length?safeUsage:null,fallback:tried>1});await save();return {...response,usage:safeUsage,provider:id,model};
    }catch(error){
     const code=error.message==='free_price_unverified'?'free_price_unverified':newsErrorCode(error),quota=id==='gemini'?googleQuotaInfo(error):null;
     p.failures++;p.failureStreak=(p.failureStreak||0)+1;p.code=code;
     const daily=quota?.quotas.some(q=>q.period==='day')||error.quotaPeriod==='day',monthly=error.quotaPeriod==='month';
     const delay=Math.max(error.retryMs||0,quota?.retryAfterMs||0,monthly?(error.retryMs||p.monthly.resetAt-clock()):daily?(error.dailyResetMs||dailyReset(id,clock())-clock()):code==='authentication'?3600000:code==='quota_or_rate_limit'?(error.minuteResetMs||60000):Math.min(900000,30000*2**Math.min(p.failureStreak-1,5)));
     p.cooldownUntil=clock()+delay;event('fallback',{provider:id,model,code,...(/^(?:title|summary|body\.\d+)$/.test(error.field||'')?{field:error.field}:{}),...(/^[a-z_]{1,40}$/.test(error.reason||'')?{reason:error.reason}:{}),latencyMs:clock()-started,quotaPeriod:monthly?'month':daily?'day':code==='quota_or_rate_limit'?'minute_or_unknown':null,resetAt:new Date(p.cooldownUntil).toISOString()});await save();
    }
   }
   await save();throw Object.assign(new Error('all_free_providers_unavailable'),{safeCode:'all_free_providers_unavailable'});
  }};
 };
 clientFactory.multiProvider=true;
 return {clientFactory,state,save,summary:()=>({attempts,estimatedCostUSD:0,providers:Object.fromEntries(Object.entries(state.providers).map(([id,p])=>[id,{...p,available:!p.cooldownUntil||p.cooldownUntil<=clock()}])),events:state.events.slice(-20)})};
}
