const hosts=new Set(['api.github.com','raw.githubusercontent.com','portwatch-vi.xyz','general-c4.github.io']);
export async function conditionalJSON(url,{etag,cached,fetchImpl=fetch,timeoutMs=12000,retries=2,sleep=ms=>new Promise(r=>setTimeout(r,ms)),headers={},onRetry=()=>{}}={}){
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!hosts.has(parsed.hostname))throw new Error('Unapproved source host');
 for(let attempt=0;;attempt++){
  try{
   const response=await fetchImpl(url,{headers:{Accept:'application/json',...headers,...(etag?{'If-None-Match':etag}:{})},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
   if(response.status===304){if(cached===undefined)throw new Error('304 without last-known-good data');return{data:cached,etag,unchanged:true};}
   if(!response.ok){
    const retryAfter=response.headers.get('retry-after');const reset=response.headers.get('x-ratelimit-reset');
    const limited=response.status===429||(response.status===403&&(response.headers.get('x-ratelimit-remaining')==='0'||retryAfter));
    const delay=retryAfter?(Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now())):reset?Math.max(0,Number(reset)*1000-Date.now()):1000*2**attempt;
    if((limited||response.status>=500)&&attempt<retries&&delay<=30000){onRetry({attempt:attempt+1,status:response.status,delayMs:delay});await sleep(delay);continue;}
    const error=new Error(`HTTP ${response.status} from ${parsed.hostname}`);error.retryAfterMs=limited?Math.max(delay,1000):undefined;throw error;
   }
   if(Number(response.headers.get('content-length')||0)>4_000_000)throw new Error('Oversized upstream response');
   const text=await response.text();if(Buffer.byteLength(text)>4_000_000)throw new Error('Oversized upstream response');
   return{data:JSON.parse(text),etag:response.headers.get('etag'),unchanged:false};
  }catch(error){
   if(attempt>=retries||error.retryAfterMs||/HTTP|JSON|Oversized|304/.test(error.message))throw error;
   const delay=1000*2**attempt;onRetry({attempt:attempt+1,error:error.name,delayMs:delay});await sleep(delay);
  }
 }
}
