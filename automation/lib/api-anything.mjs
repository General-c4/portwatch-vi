import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {validateTracker} from '../../assets/js/tracker-source.js';
export function validatePublicOperations(loaded){
 const site=loaded?.site;
 if(!site||!Array.isArray(site.operations)||!site.operations.length)throw new Error('Invalid API Anything site wrapper');
 for(const op of site.operations){const url=new URL(op.request?.url||'https://invalid.example/');if(!op.readOnly||op.request?.method!=='GET'||url.protocol!=='https:'||url.hostname!=='portwatch-vi.xyz'||url.username||url.password)throw new Error('Repaired operation failed read-only host validation');}
 return site;
}
export async function apiAnythingRead({home=resolve('.sync/api-anything'),repair=false}={}){
 // Set before importing the library. Never load everyday-browser sessions or a shared catalog.
 process.env.API_ANYTHING_HOME=home;process.env.API_ANYTHING_LOCAL_ONLY='1';
 await mkdir(join(home,'sites'),{recursive:true});
 await writeFile(join(home,'settings.json'),JSON.stringify({share:false,verify:false,localOnly:true}));
 const spec=JSON.parse(await readFile(new URL('../operations/portwatch-public.json',import.meta.url),'utf8'));
 const api=await import('api-anything');
 // The committed spec contains only observed public GET requests, no sessions or cookies.
 try{
 try{api.loadSite(spec.name);}catch{api.saveSite(spec);}
 validatePublicOperations(api.loadSite(spec.name));
 let result=await api.call('portwatch-public','tracker',{}, {maxTier:1,callOnly:true,changes:true,timeoutMs:12000,view:{fields:['updated','efforts','news','tools'],maxChars:200000}});
 let repaired=false;
 if(!result.ok&&result.class==='drift'&&repair){
  // Repair is opt-in on a host with a browser; no code from website text is evaluated.
  result=await api.heal('portwatch-public','tracker',{}, {maxTier:3,timeoutMs:20000});repaired=Boolean(result.ok&&result.healed);
 }
  if(!result.ok)return{ok:false,class:result.class,reason:result.reason,next:result.next,retryAfterMs:result.retryAfterMs};
  if(result.truncated)throw new Error('Truncated API Anything response');
  const data=Array.isArray(result.data)&&result.data.length===1?result.data[0]:result.data;
  validateTracker(data);
  validatePublicOperations(api.loadSite(spec.name));
  return{ok:true,data,changes:result.changes,ms:result.ms,repaired,heal:result.heal||null};
 }finally{await api.shutdown();await api.closeBrowser();}
}
