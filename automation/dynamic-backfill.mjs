import {readJSON,atomicJSON,hash,withLock} from './lib/state.mjs';
import {syncDynamicEditorial} from './lib/dynamic-editorial.mjs';
import {resolvedLegacyReferences,dynamicEditorialRecords} from '../assets/js/editorial-scope.js';
import {appendFile} from 'node:fs/promises';
import {createTranslationRouter} from './lib/translation-router.mjs';
await withLock('.sync/content.lock',async()=>{
 const data=await readJSON('data/tracker.json'),pinned=await readJSON('data/pinned.json'),state=await readJSON('automation/state/news-translations.json'),catalog=await readJSON('assets/i18n/news/ar.json');
 const human=await readJSON('assets/i18n/content/ar.json'),automatic=await readJSON('assets/i18n/content/ar.auto.json');
 const pending=await readJSON('automation/state/pending-translations.json');
 const approved=new Set(dynamicEditorialRecords(data,pinned).flatMap(r=>Object.values(r.fields)));
 const audit={legacyPending:pending.length,approvedEntries:pending.filter(e=>approved.has(e.source)).length,unrelatedEntries:pending.filter(e=>!approved.has(e.source)).length};
 const router=await createTranslationRouter();
 const result=await syncDynamicEditorial({data,pinned,state,catalog,human,automatic,clientFactory:router.clientFactory,onProgress:progress=>console.log(JSON.stringify({phase:'dynamic-backfill',...progress}))});
 await router.save();
 const resolved=resolvedLegacyReferences(data,{human,automatic,catalog:result.catalog},pinned);
 const remaining=pending.flatMap(entry=>{const refs=entry.refs.filter(ref=>!resolved.has(`${ref}\0${entry.source}`));return refs.length?[{...entry,refs}]:[];});
 const report={before:result.before.sections,after:result.coverage.sections,audit,stats:result.stats,missing:result.coverage.missing.map(({id,field,source})=>({id,field,source,reason:result.state.dynamic.pending[JSON.stringify([id,field])]?.lastError||'not_attempted'}))};
 if(result.stateChanged||result.catalogChanged){await atomicJSON('automation/state/news-translations.json',result.state);await atomicJSON('assets/i18n/news/ar.json',result.catalog);}
 if(hash(pending)!==hash(remaining))await atomicJSON('automation/state/pending-translations.json',remaining);
 await atomicJSON('automation/state/dynamic-coverage.json',report);
 await atomicJSON('.sync/dynamic-coverage.json',report);
 console.log(JSON.stringify({requests:result.stats.requests,translatedFields:result.stats.translatedFields,missing:report.missing.length,coverage:report.after}));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`publish=${result.catalogChanged}\nmissing=${report.missing.length}\n`);
});
