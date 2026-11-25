import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export function createProvider(name=process.env.PW_TRANSLATION_PROVIDER||'none'){
 if(name==='none')return{name,translate:async()=>{throw new Error('Translation provider unavailable');},close:()=>{}};
 if(name==='offline'){
  let child,id=0;const waiting=new Map();
  const start=()=>{
   if(child)return;
   child=spawn(process.env.PW_PYTHON||'python',['-u',new URL('../translate.py',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
   createInterface({input:child.stdout}).on('line',line=>{
    try{const message=JSON.parse(line),pending=waiting.get(message.id);if(pending){clearTimeout(pending.timer);waiting.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.text);}}catch{/* Diagnostics cannot become translations. */}
   });
   let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-1000);});
   const fail=error=>{for(const pending of waiting.values()){clearTimeout(pending.timer);pending.reject(new Error(`Offline provider failed: ${String(error.message||diagnostic).slice(0,200)}`));}waiting.clear();child=null;};
   child.on('error',fail);child.on('exit',code=>{if(code!==0)fail(new Error(diagnostic||`exit ${code}`));});
  };
  return{name:'offline-argos-en_ar-1.0-ct2-4.6.0',translate:text=>new Promise((resolve,reject)=>{
   start();const key=++id,timer=setTimeout(()=>{waiting.delete(key);reject(new Error('Translation timeout'));child?.kill();},180000);
   waiting.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:key,text})+'\n');
  }),close:()=>{child?.stdin.end();child?.kill();}};
 }
 if(name==='libretranslate'){
  // Only a deliberately configured self-hosted provider. Commercial APIs cannot be enabled implicitly.
  const url=new URL(process.env.PW_LIBRETRANSLATE_URL||'');
  if(process.env.PW_TRANSLATION_REMOTE_APPROVED!=='1')throw new Error('Remote translation requires explicit approval');
  return{name:'libretranslate-configured',translate:async text=>{
   const response=await fetch(new URL('/translate',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text,source:'en',target:'ar',format:'text',...(process.env.PW_TRANSLATION_KEY?{api_key:process.env.PW_TRANSLATION_KEY}:{})}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error(`Translation HTTP ${response.status}`);return(await response.json()).translatedText;
  },close:()=>{}};
 }
 throw new Error('Unknown translation provider');
}
