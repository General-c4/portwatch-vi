import {hash} from './state.mjs';
import {editorialQualityIssue} from '../../assets/js/editorial-quality.js';

// Extend the existing Git-persisted cache, rather than create another cache/backend.
export const fieldHashes=record=>Object.fromEntries(Object.entries(record.fields).filter(([,v])=>typeof v==='string'&&v).map(([k,v])=>[k,hash(v)]));
export const contentHash=record=>hash(fieldHashes(record));
export const validCached=(entry,source)=>entry?.source===source&&typeof entry.ar==='string'&&!editorialQualityIssue(source,entry.ar);
export function hydrateCache(state,catalog,records,{scope='news',now,days=retentionDays()}={}){
 state.cache??={};state.cacheVersion=2;
 for(const[key,entry]of Object.entries(state.cache)){
  entry.sourceHash??=hash(entry.source);entry.originalLanguage??='en';entry.targetLanguage??='ar';
  entry.status??='validated';entry.translatedAt??=null;entry.provider??='legacy-unknown';entry.model??='legacy-unknown';entry.references??={};
  entry.originalContentId??=null;entry.sourceContentHash??=entry.sourceHash;entry.fieldHashes??={source:entry.sourceHash};
 }
 // Retain pre-upgrade fields even when the first new snapshot deletes/edits them.
 for(const[id,article]of Object.entries(catalog.articles)){
  if(scope==='news'?!id.startsWith('article:')&&!records.some(r=>r.id===id):id.startsWith('article:'))continue;
  const record={id,fields:Object.fromEntries(Object.entries(article.fields||{}).map(([field,v])=>[field,v.source]))};
  for(const[field,value]of Object.entries(article.fields||{}))if(validCached(value,record.fields[field]))rememberTranslation(state,record,field,value.ar,{now,scope});
 }
 // Source presence keeps active cached translations alive, even when a reviewed
 // catalog takes precedence or the record is excluded from archive translation.
 for(const record of records)for(const field of Object.keys(record.fields))reuseTranslation(state,record,field,{now,scope,days});
}
export function rememberTranslation(state,record,field,ar,{now,provider,model,scope='news',translated=false}={}){
 state.cache??={};const source=record.fields[field],key=hash(source),old=state.cache[key];
 const entry=state.cache[key]={...old,source,ar,sourceHash:key,originalLanguage:'en',targetLanguage:'ar',status:'validated',
  translatedAt:translated?now:old?.translatedAt??null,provider:translated?provider||'unknown':old?.provider||provider||'legacy-unknown',
  model:translated?model||'unknown':old?.model||model||'legacy-unknown',references:{...old?.references}};
 entry.originalContentId=record.id;entry.sourceContentHash=contentHash(record);entry.fieldHashes={...entry.fieldHashes,[field]:key};
 const referenceKey=hash([scope,record.id,field]);
 entry.references[referenceKey]={scope,originalContentId:record.id,field,sourceContentHash:contentHash(record),fieldHashes:fieldHashes(record),orphanedAt:null};
 delete entry.orphanedAt;return entry;
}
export function reuseTranslation(state,record,field,options){
 const cached=state.cache?.[hash(record.fields[field])];
 if(cached?.orphanedAt&&Date.parse(options.now)-Date.parse(cached.orphanedAt)>=(options.days??retentionDays())*86400000)return null;
 if(!validCached(cached,record.fields[field]))return null;
 rememberTranslation(state,record,field,cached.ar,options);return {source:record.fields[field],ar:cached.ar};
}
export function retentionDays(env=process.env){const n=Number(env.TRANSLATION_CACHE_RETENTION_DAYS??30);return Number.isFinite(n)?Math.max(1,Math.min(3650,Math.trunc(n))):30;}

// Only run retirement against a validated authoritative snapshot. Failed downloads
// never call this boundary. Active entries have no TTL; orphan clocks are not renewed.
export function reconcileCache(state,catalog,records,{scope='news',now,confirmDeletions=true,days=retentionDays(),beforeRecords=[]}={}){
 state.cache??={};state.cacheRecords??={};state.cacheRecords[scope]??=Object.fromEntries(beforeRecords.map(r=>[r.id,{sourceHash:contentHash(r),fieldHashes:fieldHashes(r),orphanedAt:null}]));
 const index=state.cacheRecords[scope],active=new Map(records.map(r=>[r.id,r]));
 const stats={totalItems:records.length,newItems:0,modifiedItems:0,unchangedItems:0,deletedItems:0,expiredEntries:0};
 for(const record of records){const sourceHash=contentHash(record),old=index[record.id];
  stats[!old?'newItems':old.sourceHash!==sourceHash?'modifiedItems':'unchangedItems']++;
  if(!old||old.sourceHash!==sourceHash||old.orphanedAt)index[record.id]={sourceHash,fieldHashes:fieldHashes(record),orphanedAt:null};
 }
 if(confirmDeletions){
  for(const[id,record]of Object.entries(index))if(!active.has(id)){if(!record.orphanedAt){record.orphanedAt=now;stats.deletedItems++;}delete catalog.articles[id];
   if(Date.parse(now)-Date.parse(record.orphanedAt)>=days*86400000){delete index[id];delete state.pending?.[id];delete state.eligible?.[id];}}
  // Include pre-upgrade catalog entries when the current validated source confirms absence.
  for(const id of Object.keys(catalog.articles))if((scope==='news'?id.startsWith('article:'):!id.startsWith('article:'))&&!active.has(id))delete catalog.articles[id];
  for(const[id]of Object.entries(state.pending||{}))if(scope==='news'&&!active.has(id))delete state.pending[id];
  for(const[key,entry]of Object.entries(state.cache)){
   if(!entry.references||!Object.keys(entry.references).length){entry.orphanedAt??=now;}
   for(const ref of Object.values(entry.references||{}))if(ref.scope===scope){
    const record=active.get(ref.originalContentId),same=record&&hash(record.fields[ref.field]??null)===key;
    if(!same)ref.orphanedAt??=now;else ref.orphanedAt=null;
   }
   const refs=Object.values(entry.references||{});
   if(refs.length&&refs.every(r=>r.orphanedAt))entry.orphanedAt??=refs.map(r=>r.orphanedAt).sort().at(-1);
   else if(refs.length)delete entry.orphanedAt;
   if(entry.orphanedAt&&Date.parse(now)-Date.parse(entry.orphanedAt)>=days*86400000){delete state.cache[key];stats.expiredEntries++;}
  }
 }
 return stats;
}
export function cacheStatistics(stats){
 const hits=stats.cacheHits||0,misses=stats.cacheMisses||0;
 return {...stats,cacheHitPercentage:hits+misses?Math.round(hits/(hits+misses)*10000)/100:100,
  avoidedFieldRequests:hits+(stats.deduplicatedFields||0),
  avoidedAPIRequestsEstimate:{requests:hits+(stats.deduplicatedFields||0),baseline:'one unbatched API request per field; not measured provider requests'},estimatedCostUSD:0};
}
