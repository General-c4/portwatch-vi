import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTranslationRouter,freePolicy,retryDelay} from '../automation/lib/translation-router.mjs';
import {prepareNewsRequest,NEWS_RESPONSE_SCHEMA} from '../automation/lib/gemini-news.mjs';
import {protectText,restoreTranslation} from '../automation/lib/translations.mjs';
import {editorialQualityIssue} from '../assets/js/editorial-quality.js';
const request=()=>prepareNewsRequest({title:'New project update'},[]);
const good=()=>({text:JSON.stringify({title:'تحديث جديد للمشروع',summary:'',body:[],sourceUrls:[]}),finishReason:'STOP',usage:{promptTokenCount:20,candidatesTokenCount:10,totalTokenCount:30}});
const env={GEMINI_API_KEY:'test-secret-gemini',GROQ_API_KEY:'test-secret-groq',AXFORGE_API_KEY:'test-secret-axforge',TRANSLATION_FREE_PROVIDERS:'gemini,groq,axforge'};
const config=()=>({primary:'gemini',order:['gemini','groq'],maxAttemptsPerRun:10,providers:{gemini:{model:'gemini-3.6-flash'},groq:{model:'qwen/qwen3.8-27b'}}});
const setup=async extra=>createTranslationRouter({root:await mkdtemp(join(tmpdir(),'pw-router-')),config:config(),env,sleep:async()=>{},...extra});
for(const [label,error]of Object.entries({quota:Object.assign(new Error('quota'),{status:429}),outage:Object.assign(new Error('key=test-secret-do-not-log'),{status:503}),timeout:Object.assign(new Error('timeout'),{name:'TimeoutError'}),auth:Object.assign(new Error('invalid key'),{status:401}),network:new Error('ECONNRESET')})){
 test(`immediate ${label} fallback, sanitized persistent cooldown and provider recovery`,async()=>{
  let now=Date.parse('2026-11-28T12:00:00Z'),primary=0,secondary=0;
  const router=await setup({clock:()=>now,clientFactories:{gemini:async()=>({generate:async()=>{primary++;if(primary===1)throw error;return good();}}),groq:async()=>({generate:async()=>{secondary++;return good();}})}});
  const client=await router.clientFactory({maxOutputTokens:64});assert.equal((await client.generate(request())).provider,'groq');
  assert.equal(primary,1);assert.equal(secondary,1);assert(router.state.providers.gemini.cooldownUntil>now);
  await client.generate(request());assert.equal(primary,1);assert.equal(secondary,2);
  now=router.state.providers.gemini.cooldownUntil+1;assert.equal((await client.generate(request())).provider,'gemini');assert.equal(primary,2);
  assert(!JSON.stringify(router.state).includes('test-secret'));assert.equal(router.summary().estimatedCostUSD,0);
 });
}
test('invalid JSON, incomplete fields, copied English and altered facts trigger a validated fallback',async()=>{
 for(const text of ['not json',JSON.stringify(NEWS_RESPONSE_SCHEMA),JSON.stringify({title:'ترجمة'}),JSON.stringify({title:'New project update',summary:'',body:[],sourceUrls:[]})]){
  const router=await setup({clientFactories:{gemini:async()=>({generate:async()=>({...good(),text})}),groq:async()=>({generate:async()=>good()})}});
  assert.equal((await(await router.clientFactory({maxOutputTokens:64})).generate(request())).provider,'groq');
 }
});
test('all providers unavailable persist state; restart skips exhausted services without calls',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pw-restart-'));let calls=0;
 const factories=Object.fromEntries(['gemini','groq'].map(id=>[id,async()=>({generate:async()=>{calls++;throw Object.assign(new Error('secret'),{status:429,retryMs:3600000});}})]));
 const router=await setup({root,clientFactories:factories});await assert.rejects((await router.clientFactory({maxOutputTokens:64})).generate(request()));assert.equal(calls,2);
 const restarted=await setup({root,clientFactories:factories});await assert.rejects((await restarted.clientFactory({maxOutputTokens:64})).generate(request()));assert.equal(calls,2);
 assert(!String(await readFile(join(root,'automation/state/translation-providers.json'))).includes('test-secret'));
});
test('strict model and account policy rejects paid, arbitrary, renamed and unverified destinations',()=>{
 for(const [id,model]of[['groq','paid-model'],['gemini','gemini-3.8-pro'],['openrouter','openrouter/auto'],['axforge','gpt-5'],['hostile','qwen/qwen3.8-27b']])assert.equal(freePolicy(id,model,env),false);
 assert.equal(freePolicy('groq','qwen/qwen3.8-27b',{...env,TRANSLATION_FREE_PROVIDERS:'gemini'}),false);
 assert.equal(freePolicy('groq','qwen/qwen3.8-27b',env),true);
});
test('daily quotas recover across Pacific midnight; monthly quota reserves are durable and reset',async()=>{
 let now=Date.parse('2026-11-29T07:59:30Z'),calls=0;const c=config();c.order=['gemini'];c.providers.gemini.dailyRequests=1;
 const router=await setup({config:c,clock:()=>now,clientFactories:{gemini:async()=>({generate:async()=>{calls++;return good();}})}});
 const client=await router.clientFactory({maxOutputTokens:64});await client.generate(request());await assert.rejects(client.generate(request()));assert.equal(calls,1);
 now+=120000;await client.generate(request());assert.equal(calls,2);
 const monthly=config();monthly.primary='axforge';monthly.order=['axforge'];monthly.providers={axforge:{model:'qwen3.8-27b',monthlyTokens:20000}};
 const r=await setup({config:monthly,clock:()=>now,state:{providers:{axforge:{requests:1,monthly:{resetAt:now+1000,tokens:20000}}},events:[]},clientFactories:{axforge:async()=>({generate:async()=>good()})}});
 const cl=await r.clientFactory({maxOutputTokens:64});await assert.rejects(cl.generate(request()));now+=2000;assert.equal((await cl.generate(request())).provider,'axforge');
});
test('Retry-After seconds, duration and HTTP dates are respected',()=>{
 const now=Date.parse('2026-11-28T12:00:00Z');assert.equal(retryDelay('2',now),2000);assert.equal(retryDelay('2m3.5s',now),123500);assert.equal(retryDelay('Sat, 28 Nov 2026 12:01:00 GMT',now),60000);
});
test('OpenAI-compatible adapter uses fixed HTTPS host, refuses redirects and accounts real usage',async()=>{
 const c=config();c.order=['groq'];const calls=[];
 const router=await setup({config:c,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({choices:[{message:{content:good().text},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}});}});
 const response=await(await router.clientFactory({maxOutputTokens:64})).generate(request());assert.equal(response.provider,'groq');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(calls[0].options.redirect,'error');assert.equal(router.state.providers.groq.daily.tokens,30);
});
test('zero-price preflight prevents OpenRouter inference when a selected model becomes paid',async()=>{
 const c=config();c.order=['openrouter'];c.providers.openrouter={model:'google/gemma-4-26b-a4b-it:free'};let posts=0;
 const router=await setup({config:c,env:{OPENROUTER_API_KEY:'test-secret',TRANSLATION_FREE_PROVIDERS:'openrouter'},fetchImpl:async(_url,options)=>{if(options.method==='POST')posts++;return Response.json({data:[{id:c.providers.openrouter.model,pricing:{prompt:'0.001',completion:'0'}}]});}});
 await assert.rejects((await router.clientFactory({maxOutputTokens:64})).generate(request()));assert.equal(posts,0);assert.equal(router.state.providers.openrouter.code,'free_price_unverified');
});
test('valid Arabic non-confirmation remains negative, and HTML markup is protected verbatim',()=>{
 assert.equal(restoreTranslation('Not verified','لم تؤكد الاختبارات المستقلة ذلك',[]),'لم تؤكد الاختبارات المستقلة ذلك');
 assert.throws(()=>restoreTranslation('Not verified','أكدت الاختبارات المستقلة ذلك',[]));
 const source='A <strong>new</strong> update',protectedValue=protectText(source);
 assert.deepEqual(protectedValue.tokens.map(t=>t.original),['<strong>','</strong>']);
 assert.equal(restoreTranslation(source,`تحديث ${protectedValue.tokens[0].token}جديد${protectedValue.tokens[1].token}`,protectedValue.tokens),'تحديث <strong>جديد</strong>');
 const overlapping=protectText('Belobug and Belobug/VIctory-Belobug-AMD',['Belobug']);
 assert.equal(restoreTranslation('Belobug and Belobug/VIctory-Belobug-AMD',`${overlapping.tokens[0].token} ومستودع ${overlapping.tokens[1].token}`,overlapping.tokens),'Belobug ومستودع Belobug/VIctory-Belobug-AMD');
 const names=prepareNewsRequest({title:"Marvis's build and TeK (@TeKGameR950) on Friday"},[]);
 assert(names.protectedFields.title.tokens.some(t=>t.original==='Marvis'));assert(names.protectedFields.title.tokens.some(t=>t.original==='@TeKGameR950'));
 assert.equal(editorialQualityIssue('The repository and GitHub account are gone.','اختفى المستودع وحساب GitHub.'),null);
 assert.equal(editorialQualityIssue('The repository and GitHub account are gone.','اختفى المستودع الخاص بحساب GitHub.'),'repository_account_omitted');
});
test('valid partial fields persist across restart and only rejected fields reach the next provider',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pw-partial-')),input=prepareNewsRequest({title:'New project update',summary:'New project summary'},[]),c=config();c.order=['gemini'];
 const first=await setup({root,config:c,clientFactories:{gemini:async()=>({generate:async()=>({...good(),text:JSON.stringify({title:'تحديث جديد للمشروع',summary:'New project summary',body:[],sourceUrls:[]})})})}});
 const partial=await(await first.clientFactory({maxOutputTokens:64})).generate(input);assert.equal(partial.partial,true);assert.equal(Object.keys(first.state.pendingFields).length,1);
 c.order=['groq'];let fields;
 const restarted=await setup({root,config:c,clientFactories:{groq:async()=>({generate:async req=>{fields=Object.keys(req.fields);return {...good(),text:JSON.stringify({title:'',summary:'ملخص جديد للمشروع',body:[],sourceUrls:[]})};}})}});
 const response=await(await restarted.clientFactory({maxOutputTokens:64})).generate(input);assert.deepEqual(fields,['summary']);assert.equal(JSON.parse(response.text).title,'تحديث جديد للمشروع');assert.equal(JSON.parse(response.text).summary,'ملخص جديد للمشروع');assert.equal(Object.keys(restarted.state.pendingFields).length,0);
});
