import {mkdir,readFile,writeFile,rename,open,unlink,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export async function readJSON(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}}
export async function atomicJSON(path,value){
 await mkdir(dirname(path),{recursive:true});
 const temporary=`${path}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,path);
}
export async function withLock(path,fn){
 await mkdir(dirname(path),{recursive:true});let handle;
 try{handle=await open(path,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,at:Date.now()}));}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  let old;
  try{old=await readJSON(path,{});}catch{if(Date.now()-(await stat(path)).mtimeMs<60000)throw new Error('Synchronization lock is being initialized');old={pid:-1};}
  let running=true;
  try{process.kill(old.pid,0);}catch{running=false;}
  if(old.pid===process.pid&&old.at<Date.now()-process.uptime()*1000-500)running=false;
  if(running)throw new Error('Synchronization already running');
  await unlink(path);return withLock(path,fn);
 }
 try{return await fn();}finally{await handle.close();await unlink(path).catch(()=>{});}
}
export function log(event,fields={}){console.log(JSON.stringify({at:new Date().toISOString(),event,...fields}));}
