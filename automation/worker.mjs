// Optional always-on detector for an existing Docker/Dokploy host. Not deployed by default.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {conditionalJSON} from './lib/http.mjs';
import {atomicJSON,readJSON,hash,log,withLock} from './lib/state.mjs';
import {validateTracker} from '../assets/js/tracker-source.js';
export async function detectAndDispatch({state={},fetchImpl=fetch,dispatch,now=()=>Date.now()}={}){
 const source=await conditionalJSON('https://portwatch-vi.xyz/data/tracker.json',{etag:state.etag,cached:state.data,fetchImpl});
 validateTracker(source.data,state.data);
 const changed=!state.hash||state.hash!==hash(source.data);
 const next={etag:source.etag,data:source.data,hash:hash(source.data),checkedAt:new Date(now()).toISOString(),lastDispatchedHash:state.lastDispatchedHash||null};
 if(changed&&next.hash!==next.lastDispatchedHash){await dispatch();next.lastDispatchedHash=next.hash;next.dispatchedAt=new Date(now()).toISOString();}
 return{state:next,changed};
}
export async function runWorker(){
 const stateFile=process.env.PW_WORKER_STATE||'.sync/worker.json',interval=Math.max(30000,Number(process.env.PW_POLL_MS||60000));
 let health={status:'starting'},stopped=false;
 const server=http.createServer((request,response)=>{if(request.url!=='/health'){response.writeHead(404);response.end();return;}response.writeHead(health.status==='ok'?200:503,{'Content-Type':'application/json'});response.end(JSON.stringify(health));});
 server.listen(Number(process.env.PORT||8788),'0.0.0.0');
 const stop=()=>{stopped=true;server.close();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 let failureCount=0;
 while(!stopped){
  let delay=interval;
  try{
   await withLock(`${stateFile}.lock`,async()=>{
    const previous=await readJSON(stateFile,{});
    const result=await detectAndDispatch({state:previous,dispatch:async()=>{
     const token=process.env.GH_TOKEN;if(!token)throw new Error('A repository-scoped Actions token is required to dispatch; no credentials configured');
     const response=await fetch('https://api.github.com/repos/General-c4/portwatch-vi/actions/workflows/content-sync.yml/dispatches',{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'feat/arabic-rtl-localization'}),signal:AbortSignal.timeout(15000)});
     if(!response.ok)throw new Error(`Dispatch HTTP ${response.status}`);
    }});
    await atomicJSON(stateFile,result.state);health={status:'ok',lastCheck:result.state.checkedAt,lastDispatch:result.state.dispatchedAt||null,changed:result.changed};
   });failureCount=0;
  }catch(error){failureCount++;delay=Math.min(15*60000,interval*2**Math.min(failureCount,4));health={status:'degraded',error:error.message,retryMs:delay};log('worker-retry',health);}
  await new Promise(resolve=>{const timer=setTimeout(resolve,delay);process.once('SIGTERM',()=>{clearTimeout(timer);resolve();});});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runWorker();
