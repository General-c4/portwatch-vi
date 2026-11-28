import {appendFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {conditionalJSON} from './lib/http.mjs';
import {atomicJSON,hash,readJSON,withLock,log} from './lib/state.mjs';
import {recordDiff} from './lib/diff.mjs';
import {translationInventory,queueTranslations,translatePending,protectedTerms,dashboardSources} from './lib/translations.mjs';
import {validateTracker,validatePinned,newerSnapshot} from '../assets/js/tracker-source.js';
import {apiAnythingRead} from './lib/api-anything.mjs';
import {createProvider} from './lib/provider.mjs';
import {syncNews,newsLimits} from './lib/news-sync.mjs';
import {syncDynamicEditorial} from './lib/dynamic-editorial.mjs';
import {dynamicEditorialRecords,resolvedLegacyReferences} from '../assets/js/editorial-scope.js';

export async function syncContent({fetchImpl=fetch,apiRead=apiAnythingRead,providerFactory=createProvider,newsClientFactory,root='.',maxTranslations=40}={}){
 const started=performance.now(),now=new Date().toISOString();
 const file=path=>`${root}/${path}`;
 const before=await readJSON(file('data/tracker.json')),oldPinned=await readJSON(file('data/pinned.json'));
 const state=await readJSON(file('automation/state/content.json'),{sources:{},recentErrors:[],retryAttempts:[]});
 const errors=[],retryAttempts=[];
 const auth=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
 const headURL='https://api.github.com/repos/4lwayz/portwatch-vi/commits/main';
 const get=async(url,cached,validate=value=>value)=>{
  const saved=state.sources?.[url];
  const usable=cached!==undefined&&saved?.hash===hash(cached);
  const response=await conditionalJSON(url,{fetchImpl,cached:usable?cached:undefined,etag:usable?saved?.etag:undefined,headers:url.startsWith('https://api.github.com/')&&auth?{Authorization:`Bearer ${auth}`}:{},onRetry:entry=>retryAttempts.push({...entry,host:new URL(url).hostname})});
  const data=validate(response.data);state.sources??={};state.sources[url]={etag:response.etag,hash:hash(data)};return data;
 };
 const head=await get(headURL,state.head);
 if(!/^[a-f0-9]{40}$/.test(head.sha||''))throw new Error('Invalid upstream commit SHA');
 const raw=`https://raw.githubusercontent.com/4lwayz/portwatch-vi/${head.sha}/`;
 const attempt=async(label,fn)=>{try{return await fn();}catch(error){errors.push({at:now,source:label,message:String(error.message).slice(0,200),retryAfterMs:error.retryAfterMs});return null;}};
 const [repository,live,repoPin,livePin,english]=await Promise.all([
  attempt('repository tracker',()=>get(`${raw}data/tracker.json`,before,v=>validateTracker(v,before))),
  attempt('live tracker',()=>get('https://portwatch-vi.xyz/data/tracker.json',before,v=>validateTracker(v,before))),
  attempt('repository pinned',()=>get(`${raw}data/pinned.json`,oldPinned,validatePinned)),
  attempt('live pinned',()=>get('https://portwatch-vi.xyz/data/pinned.json',oldPinned,validatePinned)),
  attempt('interface',()=>get(`${raw}assets/i18n/en.json`,undefined,v=>{if(!v||typeof v!=='object'||Object.keys(v).length<30||Object.values(v).some(s=>typeof s!=='string'))throw new Error('Invalid English catalog');return v;})),
 ]);
 const data=live||repository;
 if(!data)throw new Error('No valid authoritative snapshot; preserving last-known-good files');
 const deployed=await attempt('deployment monitoring',()=>get('https://general-c4.github.io/portwatch-vi/deployment.json',undefined,v=>{if(!/^[a-f0-9]{40}$/.test(v?.commit||''))throw new Error('Invalid deployment descriptor');return v;}));
 if(deployed){state.latestDeployedCommitSha=deployed.commit;state.lastDeploymentStatus='verified-live';}
 const pinned=repoPin&&livePin?(Date.parse(livePin.updated)>Date.parse(repoPin.updated)?livePin:repoPin):repoPin||livePin||oldPinned;
 const canonical={source:data===live?'https://portwatch-vi.xyz/data/tracker.json':`${raw}data/tracker.json`,commit:head.sha,updated:data.updated,hash:hash(data),fetchedAt:now};
 // Publishable canonical files are independent of translation/network availability.
 // The journal is written first; translations never write records back into this snapshot.
 if(hash(before)!==hash(data)||hash(oldPinned)!==hash(pinned)){
  await atomicJSON(file('.sync/last-known-good.json'),{data:before,pinned:oldPinned});
  await atomicJSON(file('data/tracker.json'),data);await atomicJSON(file('data/pinned.json'),pinned);
 }
 let api={ok:false,reason:'No content change; read skipped',skipped:true};
 const upstreamChanged=state.upstreamSha!==head.sha;
 if(upstreamChanged||hash(data)!==hash(before)||process.env.PW_API_CHECK==='1'){
  api=await attempt('API Anything',()=>apiRead({repair:process.env.PW_API_REPAIR==='1'}))||{ok:false,reason:'Read failed'};
  if(api.ok&&hash(api.data.efforts)!==hash((live||repository).efforts))api={ok:false,reason:'Official live operation and canonical efforts differ; next cycle revalidates'};
 }
 const human={content:await readJSON(file('assets/i18n/content/ar.json')),interface:await readJSON(file('assets/i18n/ar.json')),dashboard:await readJSON(file('assets/i18n/dashboard/ar.json'))};
 const automatic={};
 const paths={content:'assets/i18n/content/ar.auto.json',interface:'assets/i18n/ar.auto.json',dashboard:'assets/i18n/dashboard/ar.auto.json'};
 for(const [scope,path]of Object.entries(paths))automatic[scope]=await readJSON(file(path),{});
 const originalAuto=hash(automatic),previousQueue=await readJSON(file('automation/state/pending-translations.json'),[]);
 const reviewedSources=await readJSON(file('assets/i18n/ar.sources.json'),{}),autoSources=await readJSON(file('assets/i18n/ar.auto.sources.json'),{});
 const localEnglish=await readJSON(file('assets/i18n/en.json'));
 const dashboardHTML=await readFile(file('dashboard/index.html'),'utf8').catch(()=>'');
 const dashboardInventory={...human.dashboard,...Object.fromEntries(dashboardSources(dashboardHTML).map(source=>[source,null]))};
 const inventory=translationInventory(data,pinned,{...localEnglish,...(english||{})},dashboardInventory);
 const effectiveHuman={...human,interface:{...human.interface}};
 for(const entry of inventory.filter(e=>e.scope==='interface')){
  if(reviewedSources[entry.key]!==undefined&&reviewedSources[entry.key]!==entry.source)delete effectiveHuman.interface[entry.key];
  if(autoSources[entry.key]!==entry.source)delete automatic.interface[entry.key];
 }
 const queued=queueTranslations(inventory,effectiveHuman,automatic,previousQueue);
 const approvedDynamicSources=new Set(dynamicEditorialRecords(data,pinned).flatMap(r=>Object.values(r.fields)));
 const scopedPending=queued.pending.filter(e=>approvedDynamicSources.has(e.source));
 let translated={remaining:queued.pending,completed:0,records:[]};let provider;
 const translationStart=performance.now();
 try{
  provider=providerFactory();
  translated=await translatePending(queued.pending.filter(e=>!approvedDynamicSources.has(e.source)),{human:effectiveHuman,automatic,translate:provider.translate,terms:protectedTerms(data),limit:maxTranslations,provider:provider.name,publishMachine:process.env.PW_TRANSLATION_REMOTE_APPROVED==='1'&&provider.name==='libretranslate-configured'});
  translated.remaining.push(...scopedPending);
 }catch(error){errors.push({at:now,source:'translation provider',message:String(error.message).slice(0,200)});}
 finally{provider?.close();}
 const translationMs=Math.round(performance.now()-translationStart);
 let news,dynamic;
 try{
  news=await syncNews({before,data:{...data,headlines:[]},human:human.content,state:await readJSON(file('automation/state/news-translations.json'),null),catalog:await readJSON(file('assets/i18n/news/ar.json'),{version:1,articles:{}}),...(newsClientFactory?{clientFactory:newsClientFactory}:{})});
  dynamic=await syncDynamicEditorial({data,pinned,state:news.state,catalog:news.catalog,human:human.content,automatic:automatic.content,limits:{...newsLimits(),maxRequests:Math.max(0,newsLimits().maxRequests-news.stats.requests)},...(newsClientFactory?{clientFactory:newsClientFactory}:{})});
  news.state=dynamic.state;news.catalog=dynamic.catalog;news.stateChanged||=dynamic.stateChanged;news.catalogChanged||=dynamic.catalogChanged;
 }catch{/* Gemini failures cannot stop canonical synchronization or leak provider error bodies. */}
 const resolved=resolvedLegacyReferences(data,{human:human.content,automatic:automatic.content,catalog:news?.catalog||{}},pinned);
 translated.remaining=translated.remaining.flatMap(entry=>{const refs=entry.refs.filter(ref=>!resolved.has(`${ref}\0${entry.source}`));return refs.length?[{...entry,refs}]:[];});
 const covered=inventory.filter(item=>typeof effectiveHuman[item.scope]?.[item.key]==='string'||typeof automatic[item.scope]?.[item.key]==='string'||resolved.has(`${item.ref}\0${item.source}`)).length;
 const coverage={total:inventory.length,translated:covered,coverage:Math.round(covered/inventory.length*10000)/100};
 if(dynamic)await atomicJSON(file('.sync/dynamic-coverage.json'),{before:dynamic.before.sections,after:dynamic.coverage.sections,missing:dynamic.coverage.missing.map(({id,field,source})=>({id,field,source,reason:dynamic.state.dynamic.pending[JSON.stringify([id,field])]?.lastError||'not_attempted'})),stats:dynamic.stats});
 const dataChanged=hash(before)!==hash(data)||hash(oldPinned)!==hash(pinned);
 const changed=dataChanged||hash(automatic)!==originalAuto||hash(previousQueue)!==hash(translated.remaining)||upstreamChanged||news?.stateChanged||news?.catalogChanged;
 const delta=recordDiff(before,data);
 const sourceState=await readJSON(file('automation/state/source.json'),{});
 const status={
  version:1,latestUpstreamCommitSha:head.sha,latestSynchronizedCommitSha:head.sha,
  latestIntegratedSourceCommitSha:sourceState.integratedUpstreamSha||null,
  latestDeployedCommitSha:state.latestDeployedCommitSha||null,lastDeploymentStatus:state.lastDeploymentStatus||'unknown',
  lastSuccessfulSyncTime:now,lastUpstreamCheckTime:now,authoritativeSource:data===live?'official-live':'repository',upstreamUpdated:data.updated,canonical,
  records:delta,translation:{coverage:coverage.coverage,translated:coverage.translated,total:coverage.total,pending:translated.remaining.length,completed:translated.completed,provider:provider?.name||'unavailable'},
  newsTranslation:news?.stats||{errors:['news_pipeline_unavailable'],requests:0},
  dynamicTranslation:dynamic?{...dynamic.stats,coverage:dynamic.coverage.sections}:null,
  latency:{sourceCheckMs:Math.round(translationStart-started),dataSyncMs:null,translationMs,deploymentMs:null,totalMs:Math.round(performance.now()-started)},
  apiAnything:{ok:api.ok,skipped:api.skipped||false,reason:api.reason||null,changes:api.changes||null,ms:api.ms||null,repaired:api.repaired||false},
  recentErrors:[...(state.recentErrors||[]),...errors].slice(-20),retryAttempts:[...(state.retryAttempts||[]),...retryAttempts].slice(-20),
 };
 // All inputs were validated before replacing canonical data. A journal keeps a recoverable release pair.
 const persistenceStart=performance.now();
 if(changed){
  await atomicJSON(file('data/tracker.json'),data);await atomicJSON(file('data/pinned.json'),pinned);
  for(const [scope,path]of Object.entries(paths))await atomicJSON(file(path),automatic[scope]);
  for(const entry of inventory.filter(e=>e.scope==='interface'))if(Object.hasOwn(automatic.interface,entry.key))autoSources[entry.key]=entry.source;
  await atomicJSON(file('assets/i18n/ar.auto.sources.json'),autoSources);
  await atomicJSON(file('automation/state/pending-translations.json'),translated.remaining);
  const records=await readJSON(file('automation/state/translation-cache.json'),{});
  for(const record of translated.records)records[record.id]=record;
  await atomicJSON(file('automation/state/translation-cache.json'),records);
  if(news){await atomicJSON(file('automation/state/news-translations.json'),news.state);await atomicJSON(file('assets/i18n/news/ar.json'),news.catalog);}
  status.latency.dataSyncMs=Math.round(performance.now()-persistenceStart);
  status.latency.totalMs=Math.round(performance.now()-started);
  await atomicJSON(file('automation/state/content.json'),{...status,upstreamSha:head.sha,head,sources:state.sources});
 }
 if(!changed){status.latency.dataSyncMs=0;status.latency.totalMs=Math.round(performance.now()-started);}
 await atomicJSON(file('.sync/status.json'),status);
 await atomicJSON(file('.sync/canonical-snapshot.json'),canonical);
 log('content-sync',{changed,dataChanged,records:delta,translations:status.translation,ms:Math.round(performance.now()-started)});
 return{changed:Boolean(changed),dataChanged,upstreamChanged,publish:Boolean(dataChanged||hash(automatic)!==originalAuto||news?.catalogChanged||!deployed||deployed.dataHash!==hash(data)),status};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 await withLock('.sync/content.lock',async()=>{
  const result=await syncContent({maxTranslations:Number(process.env.PW_TRANSLATION_LIMIT||40)});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`changed=${result.changed}\ndata_changed=${result.dataChanged}\npublish=${result.publish}\nupstream_changed=${result.upstreamChanged}\n`);
 }).catch(error=>{log('sync-failed',{error:error.message});process.exitCode=1;});
}
