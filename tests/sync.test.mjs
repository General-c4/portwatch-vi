import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {conditionalJSON} from '../automation/lib/http.mjs';
import {validateTracker,newerSnapshot} from '../assets/js/tracker-source.js';
import {recordDiff} from '../automation/lib/diff.mjs';
import {translationInventory,queueTranslations,protectText,restoreTranslation,translatePending,dashboardSources} from '../automation/lib/translations.mjs';
import {classifySourceChanges} from '../automation/lib/source-policy.mjs';
import {atomicJSON,readJSON,withLock,hash} from '../automation/lib/state.mjs';
import {syncContent} from '../automation/content-sync.mjs';
import {detectAndDispatch} from '../automation/worker.mjs';
const fixture=()=>({updated:'2026-11-25T10:00:00Z',efforts:[{id:'alpha',name:'Alpha',summary:'A project',gta:{fps:3,menu:1}}],news:[{id:'one',title:'A report',date:'2026-11-25',body:['A paragraph']}],tools:[{repo:'owner/tool',name:'Tool',desc:'A tool'}],changes:[]});
test('new static dashboard labels enter the queue without evaluating scripts or editable content',()=>{
 const sources=dashboardSources('<div>New warning &amp; status</div><input placeholder="New entry"><script>privateCode()</script><textarea>Private text</textarea>');
 assert.deepEqual(sources,['New entry','New warning & status']);
 const queued=queueTranslations(translationInventory(fixture(),null,{},Object.fromEntries(sources.map(s=>[s,null]))),{content:{},interface:{},dashboard:{}});
 assert(queued.pending.some(item=>item.scope==='dashboard'&&item.source==='New entry'));
});
test('record diff handles new/modified/deleted news and projects without recomputing progress',()=>{
 const before=fixture(),after=structuredClone(before);after.efforts[0].gta.fps=30;after.efforts[0].summary='Changed';after.efforts.push({id:'beta',name:'Beta'});after.news=[];
 const delta=recordDiff(before,after);assert.deepEqual(delta.sections.efforts,{new:1,updated:1,deleted:0});assert.equal(delta.sections.news.deleted,1);
 assert.deepEqual(validateTracker(after).efforts,after.efforts);assert.equal(before.efforts[0].gta.fps,3);
});
test('invalid, empty, duplicate, old and suspiciously incomplete snapshots are rejected',()=>{
 const valid=fixture();for(const bad of [{}, {...valid,efforts:[]},{...valid,efforts:[...valid.efforts,...valid.efforts]},{...valid,news:[{id:'../x',title:'X',body:[]}]}])assert.throws(()=>validateTracker(bad));
 assert.throws(()=>validateTracker({...valid,updated:'2020-01-01'},valid));
 const many={...valid,efforts:Array.from({length:10},(_,i)=>({id:`p${i}`,name:`P${i}`}))};assert.throws(()=>validateTracker(valid,many));
 assert.equal(newerSnapshot(valid,{...valid,updated:'2026-11-25T11:00:00Z'}).updated,'2026-11-25T11:00:00Z');
});
test('conditional ETags, HTTP 429 Retry-After and 5xx backoff',async()=>{
 let requests=0;const waits=[];
 const result=await conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{sleep:async ms=>waits.push(ms),fetchImpl:async()=>++requests===1?new Response('',{status:429,headers:{'retry-after':'2'}}):Response.json(fixture(),{headers:{etag:'test'}})});
 assert.equal(result.etag,'test');assert.deepEqual(waits,[2000]);assert.equal(requests,2);
 const cached=fixture();const unchanged=await conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{cached,etag:'tag',fetchImpl:async(_,options)=>{assert.equal(options.headers['If-None-Match'],'tag');return new Response(null,{status:304});}});assert.equal(unchanged.data,cached);
 let count=0;await conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{sleep:async()=>{},fetchImpl:async()=>++count<3?new Response('',{status:503}):Response.json(cached)});assert.equal(count,3);
});
test('network timeouts, invalid JSON and hostile source URLs fail safely',async()=>{
 const hold=setTimeout(()=>{},1000);
 try{await assert.rejects(conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{timeoutMs:5,retries:0,fetchImpl:async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('timeout'))))}));}finally{clearTimeout(hold);}
 await assert.rejects(conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{retries:0,fetchImpl:async()=>new Response('<html>error</html>')}));
 await assert.rejects(conditionalJSON('http://localhost/admin'));
});
test('stable source hashes queue changed UI keys and reuse unchanged human translations',()=>{
 const inventory=translationInventory(fixture(),{text:'Pinned'}, {'ui.new':'New warning'});
 const human={content:{'A project':'مشروع'},interface:{},dashboard:{}};
 const queue=queueTranslations(inventory,human,{});assert.ok(queue.pending.some(x=>x.scope==='interface'&&x.key==='ui.new'));
 assert.ok(!queue.pending.some(x=>x.source==='A project'));
 const changed=queueTranslations(translationInventory(fixture(),{}, {'ui.new':'Changed warning'}),human,{});
 assert.notEqual(changed.pending.find(x=>x.key==='ui.new').id,queue.pending.find(x=>x.key==='ui.new').id);
});
test('protected facts and qualifiers survive translation; unsafe or altered output is queued',async()=>{
 const source='GTA VI runs at 30 FPS for {name}.';const protectedValue=protectText(source,['GTA VI','FPS']);
 const translated=`تعمل ${protectedValue.tokens[0].token} بمعدل ${protectedValue.tokens[1].token} ${protectedValue.tokens[2].token} لدى ${protectedValue.tokens[3].token}.`;
 assert.equal(restoreTranslation(source,translated,protectedValue.tokens),'تعمل GTA VI بمعدل 30 FPS لدى {name}.');
 assert.throws(()=>restoreTranslation(source,translated.replace('ZXQ1QXZ','60'),protectedValue.tokens));
 assert.throws(()=>restoreTranslation('No public code','يوجد قانون عام',[]));
 assert.throws(()=>restoreTranslation('Unverified claim','حقيقة مؤكدة',[]));
 const item={id:'id',sourceHash:hash('A report'),scope:'content',key:'A report',source:'A report',refs:[],attempts:0};const human={content:{Existing:'بشري'}},automatic={content:{}};
 const failed=await translatePending([item],{human,automatic,translate:async()=>{throw new Error('provider failed');},terms:[],provider:'test'});assert.equal(failed.remaining.length,1);assert.equal(automatic.content['A report'],undefined);assert.equal(human.content.Existing,'بشري');
});
test('durable state, process restart, non-overlap lock and stale lock recovery',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'pw-state-')),path=join(folder,'state.json');await atomicJSON(path,{version:1});assert.deepEqual(await readJSON(path),{version:1});
 await withLock(join(folder,'lock'),async()=>{await assert.rejects(withLock(join(folder,'lock'),async()=>{}),/already running/);});
 await writeFile(join(folder,'lock'),JSON.stringify({pid:99999999}));await withLock(join(folder,'lock'),async()=>{});
});
test('always-on detector does not duplicate dispatch after restart and rejects empty responses',async()=>{
 let dispatches=0;const first=await detectAndDispatch({dispatch:async()=>dispatches++,fetchImpl:async()=>Response.json(fixture(),{headers:{etag:'one'}})});
 const restored=JSON.parse(JSON.stringify(first.state));await detectAndDispatch({state:restored,dispatch:async()=>dispatches++,fetchImpl:async()=>new Response(null,{status:304})});assert.equal(dispatches,1);
 await assert.rejects(detectAndDispatch({state:restored,dispatch:async()=>dispatches++,fetchImpl:async()=>Response.json({})}));assert.equal(dispatches,1);
});
test('source policy gates structural changes and an actual Git merge conflict preserves both histories',async()=>{
 assert.equal(classifySourceChanges(['assets/css/style.css'],3).reviewRequired,false);assert.equal(classifySourceChanges(['.github/workflows/pages.yml'],3).reviewRequired,true);
 const folder=await mkdtemp(join(tmpdir(),'pw-conflict-'));const git=args=>execFileSync('git',args,{cwd:folder,encoding:'utf8',stdio:'pipe'});
 git(['init','-b','main']);git(['config','core.autocrlf','false']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test']);await writeFile(join(folder,'app.js'),'base\n');git(['add','.']);git(['commit','-m','base']);git(['branch','upstream']);
 await writeFile(join(folder,'app.js'),'Arabic preserved\n');git(['commit','-am','Arabic']);git(['checkout','upstream']);await writeFile(join(folder,'app.js'),'Upstream new source\n');git(['commit','-am','upstream']);git(['checkout','main']);assert.throws(()=>git(['merge','--no-commit','upstream']));assert.match(await readFile(join(folder,'app.js'),'utf8'),/Arabic preserved[\s\S]*Upstream new source/);git(['merge','--abort']);assert.equal(await readFile(join(folder,'app.js'),'utf8'),'Arabic preserved\n');
});
test('real sync transaction preserves old data on bad sources and accepts changed official records with translation offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pw-cycle-'));const before=fixture();
 for(const [path,value]of Object.entries({'data/tracker.json':before,'data/pinned.json':{text:'Old pin',updated:before.updated},'assets/i18n/content/ar.json':{},'assets/i18n/ar.json':{},'assets/i18n/en.json':{},'assets/i18n/dashboard/ar.json':{}}))await atomicJSON(join(root,path),value);
 const head={sha:'a'.repeat(40)},next={...structuredClone(before),updated:'2026-11-25T11:00:00Z'};next.efforts[0].gta.fps=29.7;next.efforts[0].summary='Modified description';next.efforts.push({id:'new',name:'New',summary:'New project'});
 const fetchImpl=async url=>url.includes('/commits/')?Response.json(head):url.endsWith('pinned.json')?Response.json({text:'New pin',updated:next.updated}):url.endsWith('en.json')?Response.json(Object.fromEntries(Array.from({length:31},(_,i)=>[`key.${i}`,`New key ${i}`]))):Response.json(next);
 const result=await syncContent({root,fetchImpl,apiRead:async()=>({ok:false,reason:'fixture operation failed'}),providerFactory:()=>({name:'none',close:()=>{}})});
 assert.equal(result.dataChanged,true);assert.deepEqual(await readJSON(join(root,'data/tracker.json')),next);assert.equal(result.status.apiAnything.ok,false);assert.ok(result.status.translation.pending>0);
 const original=await readFile(join(root,'data/tracker.json'),'utf8');await assert.rejects(syncContent({root,fetchImpl:async url=>url.includes('/commits/')?Response.json(head):Response.json({}),apiRead:async()=>({ok:false}),providerFactory:()=>({name:'none',close:()=>{}})}));assert.equal(await readFile(join(root,'data/tracker.json'),'utf8'),original);
});
