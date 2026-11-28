// Small, public synthetic sample; never prints credentials or provider exception bodies.
import {createTranslationRouter} from './lib/translation-router.mjs';
import {prepareNewsRequest,validateNewsResponse,createGeminiNewsClient} from './lib/gemini-news.mjs';
import {readJSON,atomicJSON} from './lib/state.mjs';
const configuration=await readJSON('automation/translation-providers.json'),results=[];
const request=prepareNewsRequest({title:'GTA VI project reports 20 FPS on NVIDIA',summary:'The developer says the result may improve; independent testing has not verified it.'},[],['GTA VI','NVIDIA']);
const selected=process.env.PW_PROBE_MODE==='fallback'?[]:process.env.PW_PROBE_PROVIDERS?.split(',')||['gemini','groq','cloudflare','zai'];
for(const id of selected){
 if(!configuration.providers[id])throw new Error('Unknown configured provider');
 const config=structuredClone(configuration);config.order=[id];config.maxAttemptsPerRun=1;
 let candidate;
 const router=await createTranslationRouter({config,onCandidate:value=>{
  let text=String(value.text||'').slice(0,6000);
  for(const name of ['GEMINI_API_KEY','GROQ_API_KEY','CLOUDFLARE_API_TOKEN','ZAI_API_KEY'])if(process.env[name])text=text.replaceAll(process.env[name],'[REDACTED]');
  candidate={text,finishReason:value.finishReason};
 }}),started=Date.now();
 try{
  const response=await(await router.clientFactory({maxOutputTokens:1024,timeoutMs:60000})).generate(request);
  results.push({provider:id,model:response.model,passed:true,latencyMs:Date.now()-started,translations:validateNewsResponse(request,response.text),usage:response.usage,costUSD:0});
 }catch{results.push({provider:id,passed:false,latencyMs:Date.now()-started,candidate,state:router.summary()});}
 await router.save();
}
if(process.env.PW_PROBE_MODE==='fallback'){
 const config=structuredClone(configuration);config.order=['gemini','groq','cloudflare','zai'];config.maxAttemptsPerRun=5;
 let inject=true;
 const router=await createTranslationRouter({config,clientFactories:{gemini:async options=>inject?{generate:async()=>{inject=false;throw Object.assign(new Error('controlled_test_outage'),{status:503});}}:createGeminiNewsClient(options)}});
 const original=structuredClone(router.state.providers.gemini||{}),eventStart=router.state.events.length;
 let first,recovered;
 try{
  first=await(await router.clientFactory({maxOutputTokens:1024,timeoutMs:60000})).generate(request);
  const until=router.state.providers.gemini.cooldownUntil;
  // The injected outage made no Google request: remove its synthetic usage reservation,
  // while keeping the cooldown so recovery exercises the real clock and production router.
  router.state.providers.gemini={...original,cooldownUntil:until,code:'controlled_test_outage'};
  for(const event of router.state.events.slice(eventStart))if(event.provider==='gemini'&&event.code==='service_unavailable')event.faultInjected=true;
  await router.save();
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,until-Date.now()+20)));
  recovered=await(await router.clientFactory({maxOutputTokens:1024,timeoutMs:60000})).generate(request);
  results.push({test:'controlled_outage_and_recovery',injectedPrimaryStatus:503,googleOutageWasSimulated:true,fallbackProvider:first.provider,recoveredProvider:recovered.provider,passed:first.provider!=='gemini'&&recovered.provider==='gemini',fallbackArabic:validateNewsResponse(request,first.text),recoveredArabic:validateNewsResponse(request,recovered.text),state:router.summary()});
 }catch{results.push({test:'controlled_outage_and_recovery',passed:false,googleOutageWasSimulated:true,state:router.summary()});}
 await router.save();
}
await atomicJSON('.sync/provider-probe.json',{at:new Date().toISOString(),sample:request.fields,results});
for(const result of results)console.log(JSON.stringify(result));
