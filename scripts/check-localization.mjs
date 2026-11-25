import {readFile} from 'node:fs/promises';
import {contentInventory} from './lib/content-coverage.mjs';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const dictionary=await read('assets/i18n/content/ar.json');
const inventory=contentInventory(await read('data/tracker.json'));
const missing=inventory.filter(({source})=>typeof dictionary[source]!=='string');
console.log(`Arabic editorial coverage: ${inventory.length-missing.length}/${inventory.length} fields (${((inventory.length-missing.length)/inventory.length*100).toFixed(1)}%)`);
for(const entry of missing)console.log(`${entry.path}: ${entry.source}`);
// A new scout item is allowed to fall back to English. Reporting gaps must not stop automatic updates.
if(process.argv.includes('--strict') && missing.length)process.exitCode=1;
