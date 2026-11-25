// One explicitly dispatched, non-publishing article check, at most two generation attempts.
import {createGeminiNewsClient,prepareNewsRequest,validateNewsResponse,newsErrorCode} from './lib/gemini-news.mjs';
import {atomicJSON} from './lib/state.mjs';
const source={title:'Leonida Reforge reports 12.5 fps in an unverified test',summary:'The native PC port remains a work in progress.',body:['The developers say rendering may improve. This is an unverified claim, not an independent benchmark.','GTA VI and Vulkan remain unchanged. Source: https://example.com/translation-test']};
const request=prepareNewsRequest({title:source.title,summary:source.summary,...Object.fromEntries(source.body.map((p,i)=>[`body.${i}`,p]))},['https://example.com/translation-test'],['GTA VI','Vulkan']);
let phase='initialization',modelInfo,requests=0;
const attempts=[];
try{
 const client=await createGeminiNewsClient();if(!client)throw new Error('unconfigured');
 phase='model-metadata';modelInfo=await client.getModel();
 for(let attempt=0;attempt<2;attempt++){
  const started=performance.now();let usage={};
  try{
   phase='generation';requests++;const response=await client.generate(request);usage=response.usage;
   const durationMs=Math.round(performance.now()-started);
   phase='validation';const translated=validateNewsResponse(request,response.text);
   attempts.push({status:'success',durationMs,usage});
   const result={status:'success',synthetic:true,published:false,model:client.model,modelInfo,requests,durationMs,usage,attempts,source,translated};
   await atomicJSON('.sync/gemini-news-smoke.json',result);
   console.log(JSON.stringify({status:result.status,model:result.model,requests,durationMs,usage}));break;
  }catch(error){
   const code=newsErrorCode(error);attempts.push({status:'failed',code,phase,durationMs:Math.round(performance.now()-started),usage,...(phase==='validation'?{field:error.field,reason:error.reason,copiedSource:error.copiedSource,copiedProtectedSource:error.copiedProtectedSource}:{})});
   if(attempt===1||['authentication','unsupported_model','quota_or_rate_limit','invalid_request_or_model'].includes(code))throw error;
   await new Promise(r=>setTimeout(r,2000));
  }
 }
}catch(error){
 const code=newsErrorCode(error);await atomicJSON('.sync/gemini-news-smoke.json',{status:'failed',code,phase,httpStatus:Number(error?.status)||null,modelInfo,requests,attempts,...(phase==='validation'?{field:error.field,reason:error.reason}:{}),synthetic:true,published:false});
 console.error(`Gemini smoke check failed: ${code} (${phase})`);process.exitCode=1;
}
