import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async (code) => JSON.parse(await readFile(new URL(`../assets/i18n/${code}.json`, import.meta.url), 'utf8'));
const ar = await read('ar');
test('Arabic covers the complete template and English keys with matching placeholders', async () => {
 for (const code of ['en','pt-BR']) for (const [key,value] of Object.entries(await read(code))) {
  if(typeof ar[key]!=='string'){
   const automatic=await read('ar.auto');let queued=[];try{queued=JSON.parse(await readFile(new URL('../automation/state/pending-translations.json',import.meta.url),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
   assert.ok(typeof automatic[key]==='string'||queued.some(e=>e.scope==='interface'&&e.key===key&&e.source===value),key);continue;
  }
  assert.equal(typeof ar[key], 'string', key);
  assert.deepEqual([...ar[key].matchAll(/\{\w+\}/g)].map(x=>x[0]).sort(), [...value.matchAll(/\{\w+\}/g)].map(x=>x[0]).sort(), key);
  assert.match(ar[key], /[\u0600-\u06ff]/, key);
 }
});
const values = new Map();
globalThis.localStorage = {getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,v)};
Object.defineProperty(globalThis,'navigator',{value:{languages:['ar-SA']},configurable:true});
globalThis.document = {documentElement:{},querySelector:()=>null,querySelectorAll:()=>[]};
globalThis.window = {};
globalThis.fetch = async url => ({ok:true,json:()=>read(url.pathname.split('/').pop().replace('.json',''))});
const i18n = await import('../assets/js/i18n.js');
test('regional Arabic detection respects saved language and browser priority',()=>{
 for (const code of ['ar-SA','ar-AE','ar-EG','ar']) {navigator.languages=[code];assert.equal(i18n.pickLang(),'ar');}
 values.set('pw-lang','es');assert.equal(i18n.pickLang(),'es');values.clear();
 navigator.languages=['en-US','ar-SA'];assert.equal(i18n.pickLang(),'en');
 navigator.languages=['ar-SA'];
});
test('all six Arabic plural forms, bidi substitutions and direction restoration',async()=>{
 await i18n.initI18n();assert.equal(document.documentElement.dir,'rtl');
 for (const n of [0,1,2,3,11,100]) {
  const category = new Intl.PluralRules('ar').select(n);
  assert.equal(i18n.tn('board.threads',n), ar[`board.threads_${category}`].replace('{n}',`\u2068${n}\u2069`));
 }
 values.set('pw-lang','en');await i18n.initI18n();assert.equal(document.documentElement.dir,'ltr');assert.equal(document.documentElement.lang,'en');
});
