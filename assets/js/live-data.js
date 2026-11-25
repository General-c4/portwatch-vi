import {LIVE_SYNC,SCORING_HASH,POLL_MS} from './sync-config.js';
import {validateTracker,validatePinned} from './tracker-source.js';
const origin='https://portwatch-vi.xyz/';
const cache=new Map();let scoringOK=false,nextAttempt=0,failures=0;
const fingerprint=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
async function remote(path){
 const previous=cache.get(path);
 const response=await fetch(new URL(path,origin),{mode:'cors',cache:'no-cache',credentials:'omit',headers:previous?.etag?{'If-None-Match':previous.etag}:{},signal:AbortSignal.timeout(5000)});
 if(response.status===304&&previous)return previous.data;
 if(!response.ok){const error=new Error('Live source unavailable');error.delay=Number(response.headers.get('retry-after')||0)*1000;throw error;}
 const text=await response.text();if(text.length>4_000_000)throw new Error('Live source too large');
 const data=path.endsWith('.json')?JSON.parse(text):text;
 cache.set(path,{etag:response.headers.get('etag'),data});return data;
}
async function compatible(){
 if(!SCORING_HASH)return false;
 scoringOK=await fingerprint((await remote('assets/js/scoring.js')).replace(/\r\n/g,'\n'))===SCORING_HASH;return scoringOK;
}
export async function loadTracker(){
 const response=await fetch(new URL('../../data/tracker.json',import.meta.url),{cache:'no-cache'});
 if(!response.ok)throw new Error(`Tracker HTTP ${response.status}`);
 const local=validateTracker(await response.json());
 if(!LIVE_SYNC)return local;
 try{if(await compatible())return structuredClone(validateTracker(await remote('data/tracker.json'),local));}catch{/* Last validated deployed data remains usable offline. */}
 return local;
}
export async function loadPinned(){
 const local=await fetch(new URL('../../data/pinned.json',import.meta.url),{cache:'no-cache'}).then(r=>r.ok?r.json():null).catch(()=>null);
 if(!LIVE_SYNC)return local;
 try{const live=validatePinned(await remote('data/pinned.json'));return Date.parse(live.updated)>=Date.parse(local?.updated||0)?live:local;}catch{return local;}
}
export function restoreLiveView(){
 try{const value=JSON.parse(sessionStorage.getItem('pw-live-view')||'null');sessionStorage.removeItem('pw-live-view');return value;}catch{return null;}
}
export function startLiveUpdates(data,pinned,getView){
 if(!LIVE_SYNC)return;
 let running=false;
 // Baseline is calculated before app.js attaches its derived, local render fields to records.
 const baseline=Promise.all([fingerprint(data),pinned.then(fingerprint)]);
 const check=async()=>{
  if(running||document.hidden||Date.now()<nextAttempt||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select'))return;
  running=true;
  try{
   if(!await compatible())return;
   const [previous,tracker,pin]=await Promise.all([baseline,remote('data/tracker.json'),remote('data/pinned.json')]);
   validateTracker(tracker,data);validatePinned(pin);
   const current=await Promise.all([fingerprint(tracker),fingerprint(pin)]);
   failures=0;
   if(current.some((value,i)=>value!==previous[i])){
    try{sessionStorage.setItem('pw-live-view',JSON.stringify({...getView(),scrollY:scrollY,folds:[...document.querySelectorAll('details.fold[open]')].map(e=>e.id)}));}catch{}
    location.reload();
   }
  }catch(error){failures++;nextAttempt=Date.now()+Math.max(error.delay||0,Math.min(15*60_000,POLL_MS*2**Math.min(failures,4)));}
  finally{running=false;}
 };
 setInterval(check,POLL_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
}
