// Local and fork-only review build. Does not run the scout, analytics writes or IndexNow pings.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildSite } from './lib/site-build.mjs';
const out = process.argv[2] || '_site';
await mkdir(out, {recursive:true});
for (const file of ['index.html','assets','data']) await cp(file,join(out,file),{recursive:true});
const data = JSON.parse(await readFile('data/tracker.json','utf8'));
for (const [path,content] of Object.entries(buildSite(data).files)) {
 const target=join(out,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content);
}
await writeFile(join(out,'.nojekyll'),'');
if (process.env.PW_PREVIEW === '1') {
 // The review copy must not count visits in the production database or be indexed.
 await writeFile(join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
 const config=join(out,'assets/js/config.js');
 await writeFile(config,(await readFile(config,'utf8')).replace('export const STATS_PAUSED = false','export const STATS_PAUSED = true'));
}
console.log(`Built review site in ${out}`);
