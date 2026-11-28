// Small, public synthetic sample; never prints credentials or provider exception bodies.
import {createTranslationRouter} from './lib/translation-router.mjs';
import {prepareNewsRequest,validateNewsResponse} from './lib/gemini-news.mjs';
import {readJSON,atomicJSON} from './lib/state.mjs';
const configuration=await readJSON('automation/translation-providers.json'),results=[];
const request=prepareNewsRequest({title:'GTA VI project reports 20 FPS on NVIDIA',summary:'The developer says the result may improve; independent testing has not verified it.'},[],['GTA VI','NVIDIA']);
const selected=process.env.PW_PROBE_PROVIDERS?.split(',')||['gemini','groq','cloudflare','zai'];
for(const id of selected){
 if(!configuration.providers[id])throw new Error('Unknown configured provider');
 const config=structuredClone(configuration);config.order=[id];config.maxAttemptsPerRun=1;
 const router=await createTranslationRouter({config}),started=Date.now();
 try{
  const response=await(await router.clientFactory({maxOutputTokens:1024,timeoutMs:60000})).generate(request);
  results.push({provider:id,model:response.model,passed:true,latencyMs:Date.now()-started,translations:validateNewsResponse(request,response.text),usage:response.usage,costUSD:0});
 }catch{results.push({provider:id,passed:false,latencyMs:Date.now()-started,state:router.summary()});}
 await router.save();
}
await atomicJSON('.sync/provider-probe.json',{at:new Date().toISOString(),sample:request.fields,results});
for(const result of results)console.log(JSON.stringify(result));
