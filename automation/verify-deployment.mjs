import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateTracker} from '../assets/js/tracker-source.js';
const base=process.env.PW_SITE_URL||'https://general-c4.github.io/portwatch-vi/';
const expected=JSON.parse(await readFile('_site/deployment.json','utf8'));
let error;
for(let attempt=0;attempt<6;attempt++){
 try{
  const get=async path=>{const r=await fetch(new URL(`${path}?verify=${Date.now()}`,base),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r;};
  const deployed=await(await get('deployment.json')).json();if(deployed.commit!==expected.commit||deployed.dataHash!==expected.dataHash)throw new Error('CDN still serves a previous release');
  const tracker=validateTracker(await(await get('data/tracker.json')).json());
  if(createHash('sha256').update(JSON.stringify(tracker)).digest('hex')!==expected.dataHash)throw new Error('Deployed data hash mismatch');
  for(const path of ['assets/i18n/ar.json','assets/i18n/content/ar.json','assets/i18n/content/ar.auto.json','assets/js/live-data.js','assets/js/tracker-source.js','assets/js/sync-config.js','assets/css/style.css','news/'])await get(path);
  for(const news of tracker.news)await get(`news/${news.id}.html`);
  let sync={};try{sync=JSON.parse(await readFile('automation/state/content.json','utf8'));}catch{}
  const verifiedAt=new Date().toISOString();
  await writeFile('.sync/deployment-status.json',JSON.stringify({...sync,status:'success',lastDeploymentStatus:'success',latestDeployedCommitSha:deployed.commit,verifiedAt,upstreamUpdated:tracker.updated,attempts:attempt+1,latency:{...sync.latency,deploymentMs:Date.parse(verifiedAt)-Date.parse(deployed.builtAt)}}));
  console.log(`Verified deployed commit ${deployed.commit}, data hash, catalogs, assets and ${tracker.news.length} articles.`);process.exit(0);
 }catch(e){error=e;if(attempt<5)await new Promise(r=>setTimeout(r,Math.max(1,Number(process.env.PW_VERIFY_RETRY_MS||10000))));}
}
throw error;
