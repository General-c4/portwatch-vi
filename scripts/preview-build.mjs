// Local and fork-only review build. Does not run the scout, analytics writes or IndexNow pings.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildSite } from './lib/site-build.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateTracker,validatePinned} from '../assets/js/tracker-source.js';
const out = process.argv[2] || '_site';
const reviewHtml = (html) => process.env.PW_PREVIEW === '1' ? html.replace('<head>', `<head>
  <meta name="robots" content="noindex">
  <script>try { if (!localStorage.getItem('pw-lang')) localStorage.setItem('pw-lang', 'ar'); } catch {}</script>`) : html;
await mkdir(out, {recursive:true});
for (const file of ['index.html','assets','data']) await cp(file,join(out,file),{recursive:true});
let data = validateTracker(JSON.parse(await readFile('data/tracker.json','utf8')));
try{const review=JSON.parse(await readFile('automation/review/upstream.json','utf8'));if(review.reviewRequired)throw new Error('Unresolved upstream review cannot deploy');}catch(error){if(error.code!=='ENOENT')throw error;}
if (process.env.PW_PREVIEW === '1' && process.env.PW_REFRESH_UPSTREAM === '1') {
 // A fork preview follows the existing upstream scout's output, without running another scout.
 const root='https://raw.githubusercontent.com/4lwayz/portwatch-vi/main/data/';
 const get=async name=>{
  const response=await fetch(root+name,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
 };
 const [tracker,pinned]=await Promise.all([get('tracker.json'),get('pinned.json')]);
 validateTracker(tracker,data);validatePinned(pinned);
 data=tracker;
 await writeFile(join(out,'data/tracker.json'),JSON.stringify(tracker));
 await writeFile(join(out,'data/pinned.json'),JSON.stringify(pinned));
}
for (const [path,content] of Object.entries(buildSite(data).files)) {
 const target=join(out,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,path.endsWith('.html') ? reviewHtml(content) : content);
}
await writeFile(join(out,'.nojekyll'),'');
if (process.env.PW_PREVIEW === '1') {
 const index=join(out,'index.html');await writeFile(index,reviewHtml(await readFile(index,'utf8')));
 // The review copy must not count visits in the production database or be indexed.
 await writeFile(join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
 const config=join(out,'assets/js/config.js');
 await writeFile(config,(await readFile(config,'utf8')).replace('export const STATS_PAUSED = false','export const STATS_PAUSED = true'));
 const scoring=createHash('sha256').update((await readFile('assets/js/scoring.js','utf8')).replace(/\r\n/g,'\n')).digest('hex');
 await writeFile(join(out,'assets/js/sync-config.js'),`export const LIVE_SYNC = true;\nexport const SCORING_HASH = ${JSON.stringify(scoring)};\nexport const POLL_MS = 60000;\n`);
}
const commit=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await writeFile(join(out,'deployment.json'),JSON.stringify({commit,upstreamUpdated:data.updated,dataHash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),builtAt:new Date().toISOString()}));
console.log(`Built review site in ${out}`);
