// One explicitly dispatched, non-publishing API check. No historical article is sent.
import {createGeminiNewsClient,prepareNewsRequest,validateNewsResponse,newsErrorCode} from './lib/gemini-news.mjs';
import {atomicJSON} from './lib/state.mjs';
const source={title:'Leonida Reforge reports 12.5 fps in an unverified test',summary:'The native PC port remains a work in progress.',body:['The developers say rendering may improve. This is an unverified claim, not an independent benchmark.','GTA VI and Vulkan remain unchanged. Source: https://example.com/translation-test']};
const request=prepareNewsRequest({title:source.title,summary:source.summary,...Object.fromEntries(source.body.map((p,i)=>[`body.${i}`,p]))},['https://example.com/translation-test'],['GTA VI','Vulkan']);
try{
 const client=await createGeminiNewsClient();if(!client)throw new Error('unconfigured');
 const started=performance.now(),response=await client.generate(request),durationMs=Math.round(performance.now()-started);
 const translated=validateNewsResponse(request,response.text);
 const result={status:'success',synthetic:true,published:false,model:client.model,requests:1,durationMs,usage:response.usage,source,translated};
 await atomicJSON('.sync/gemini-news-smoke.json',result);
 console.log(JSON.stringify({status:result.status,model:result.model,requests:1,durationMs,usage:response.usage}));
}catch(error){
 const code=newsErrorCode(error);await atomicJSON('.sync/gemini-news-smoke.json',{status:'failed',code,synthetic:true,published:false});
 console.error(`Gemini smoke check failed: ${code}`);process.exitCode=1;
}
