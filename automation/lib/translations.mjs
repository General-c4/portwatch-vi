import {contentInventory} from '../../scripts/lib/content-coverage.mjs';
import {hash} from './state.mjs';
export function dashboardSources(html=''){
 // Inventory static UI only. Never execute dashboard code or inspect private user data.
 const decode=s=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[m]).replace(/\s+/g,' ').trim();
 const clean=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|textarea)\b[^>]*>[^]*?<\/\1\s*>/gi,'');
 const values=[];
 for(const tag of clean.match(/<[^>]+>/g)||[])for(const match of tag.matchAll(/\b(?:placeholder|aria-label)\s*=\s*(["'])(.*?)\1/gi))values.push(decode(match[2]));
 for(const match of clean.matchAll(/>([^<>]+)</g))values.push(decode(match[1]));
 return [...new Set(values.filter(v=>/[A-Za-z]{2}/.test(v)&&!/^https?:/.test(v)))];
}
export function translationInventory(data,pinned,english={},dashboard={}){
 const result=contentInventory(data).map(({path,source})=>{
  const [section,index,...rest]=path.split('.'),record=data[section]?.[Number(index)];
  const ref=record&&(record.id||record.repo||record.link)?`${section}:${record.id||record.repo||record.link}.${rest.join('.')}`:path;
  return{scope:'content',key:source,source,ref};
 });
 if(pinned?.text)result.push({scope:'content',key:pinned.text,source:pinned.text,ref:'pinned.text'});
 for(const [key,source]of Object.entries(english))if(typeof source==='string')result.push({scope:'interface',key,source,ref:`interface.${key}`});
 for(const source of Object.keys(dashboard))result.push({scope:'dashboard',key:source,source,ref:`dashboard.${hash(source).slice(0,12)}`});
 return result;
}
export function queueTranslations(inventory,human,automatic={},previous=[]){
 const old=new Map(previous.map(item=>[item.id,item])),pending=new Map();let translated=0;
 for(const item of inventory){
  if(typeof human[item.scope]?.[item.key]==='string'||typeof automatic[item.scope]?.[item.key]==='string'){translated++;continue;}
  const id=hash(`${item.scope}\0${item.source}`),entry=pending.get(id)||{id,sourceHash:hash(item.source),scope:item.scope,key:item.key,source:item.source,refs:[],attempts:old.get(id)?.attempts||0,lastError:old.get(id)?.lastError||null,reviewRequired:old.get(id)?.reviewRequired||false,...(old.get(id)?.draft?{draft:old.get(id).draft}:{})};
  entry.refs.push(item.ref);pending.set(id,entry);
 }
 return{pending:[...pending.values()].sort((a,b)=>a.attempts-b.attempts||a.source.length-b.source.length),total:inventory.length,translated,coverage:inventory.length?Math.round(translated/inventory.length*10000)/100:100};
}
export function protectedTerms(data){
 const names=['GTA VI','GTA 6','PortWatch VI','PortWatch','GitHub','Rockstar Games','Rockstar','Take-Two','Microsoft','Xbox Series X|S','Xbox Series','Xbox One','Windows','Linux','macOS','YouTube','Rumble','NVIDIA','AMD','Intel','Radeon','Ryzen','DirectX','Vulkan','SPIR-V','DXIL','D3D12','RDNA2','README','DMCA','FPS','C++','C#'];
 for(const e of [...(data.efforts||[]),...(data.tools||[])]){if(e.name)names.push(e.name);if(e.repo)names.push(e.repo,e.repo.split('/')[0]);}
 return [...new Set(names)].filter(Boolean).sort((a,b)=>b.length-a.length);
}
export function protectText(source,terms=[],options={}){
 const escaped=terms.map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const compound=options.nested?'(?!)':'\\b[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+\\b';
 const pattern=new RegExp(`<\\/?[A-Za-z][^>]*>|https?:\\/\\/[^\\s<>]+|\\{[A-Za-z_][\\w]*\\}|\\x60[^\\x60]+\\x60|[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+|${escaped.join('|')||'(?!)'}|\\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\\b|${compound}|\\b[A-Z][A-Z0-9_.+-]{1,}\\b|\\b\\d+(?:[.,:/–-]\\d+)*(?:%|[A-Za-z]+)?`,'g');
 const tokens=[];const text=source.replace(pattern,original=>{
  if(!options.nested&&options.isProseCompound?.(original)){
   const nested=protectText(original,terms,{nested:true});
   // Keep names/numbers inside ordinary hyphenated prose, while allowing the prose to translate.
   const mappings=new Map();for(const entry of nested.tokens){if(entry.original===original){continue;}const token=`ZXQ${tokens.length}QXZ`;tokens.push({token,original:entry.original});mappings.set(entry.token,token);}
   if(!mappings.size)return original;
   return nested.text.replace(/ZXQ\d+QXZ/g,token=>mappings.get(token)||original);
  }
  const token=`ZXQ${tokens.length}QXZ`;tokens.push({token,original});return token;
 });
 return{text,tokens};
}
export function restoreTranslation(source,translated,tokens){
 if(typeof translated!=='string'||!translated.trim()||translated.length>Math.max(500,source.length*5)||/[<>]/.test(translated))throw new Error('Invalid translation text');
 let value=translated;
 for(const {token,original}of tokens){
  if(value.split(token).length!==2)throw new Error(`Protected token not preserved: ${token}`);
  value=value.replace(token,original);
 }
 if(/ZXQ\d+QXZ/.test(value)||!/[\u0600-\u06ff]/.test(value))throw new Error('Missing Arabic output');
 let residue=value;for(const{original}of tokens)residue=residue.split(original).join('');
 if(tokens.length&&/[A-Za-z]{2,}/.test(residue))throw new Error('Untranslated prose requires review');
 const numbers=s=>[...s.matchAll(/\d+(?:[.,]\d+)*/g)].map(m=>m[0]).sort();
 if(JSON.stringify(numbers(source))!==JSON.stringify(numbers(value)))throw new Error('Numeric facts changed');
 const placeholders=s=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
 if(JSON.stringify(placeholders(source))!==JSON.stringify(placeholders(value)))throw new Error('Placeholders changed');
 const plain=value.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'');
 // Conservative guard, not a claim of semantic proof. Keep English queued when negation disappears.
 if(/\b(?:not|never|no|without|cannot|can't|isn't|hasn't|won't|doesn't)\b/i.test(source)&&!/(?:لا|لم|لن|ليس|غير|دون|بدون|ليست)/.test(plain))throw new Error('Negation requires review');
 if((source.match(/\n/g)||[]).length!==(value.match(/\n/g)||[]).length)throw new Error('Line breaks changed');
 if(/\bcode\b/i.test(source)&&!/شيفر|شفر|كود|برمج/.test(plain))throw new Error('Technical code terminology requires review');
 if(/\brender(?:ing|s)?\b/i.test(source)&&!/رسوم|رسم|عرض|تصيير|إظهار/.test(plain))throw new Error('Rendering terminology requires review');
 if(/\bframe rate\b/i.test(source)&&!/إطار|إطارات|FPS|fps/.test(plain))throw new Error('Frame-rate terminology requires review');
 if(/ray.trac/i.test(source)&&!/تتبع الأشعة/.test(plain))throw new Error('Ray tracing terminology requires review');
 const qualifiers=[[/\b(?:unverified|not verified)\b/i,/غير مؤكد|غير متحقق|لم.*(?:تحقق|تؤكد|يؤكد)|دون.*تحقق|غير موثق/],[/\bself-reported\b/i,/ذات|صاحب|أصحاب|المشروع|إبلاغ|إفادة|مطور|بحسب.*تقرير/],[/\b(?:claims?|allegedly)\b/i,/يدعي|تدعي|يزعم|تزعم|ادعاء|زعم|بحسب/]];
 for(const [english,arabic]of qualifiers)if(english.test(source)&&!arabic.test(plain))throw new Error('Evidence qualifier requires review');
 return value.trim();
}
export function deterministicTranslation(source){
 let m=/^Scout spotted ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) \((possible effort|tool), substance (\d+)\)\.$/.exec(source);
 if(m)return `رصد الكاشف ${m[1]} (${m[2]==='tool'?'أداة':'مشروع محتمل'}، المحتوى التقني ${m[3]}).`;
 m=/^(\d+\+?) commits\/7d$/.exec(source);if(m)return `${m[1]} تعديل / 7 أيام`;
 m=/^(\d+) technical terms$/.exec(source);if(m)return `${m[1]} مصطلحًا تقنيًا`;
 m=/^About ([\d.]+(?:-[\d.]+)?) fps$/.exec(source);if(m)return `نحو ${m[1]} إطارًا/ث`;
 if(source==='Verified by PortWatch')return 'تحقق منه PortWatch';
 return null;
}
export async function translatePending(queue,{human,automatic,translate,terms,limit=40,provider='none',publishMachine=false}){
 const records=[],remaining=[];let completed=0,attempted=0,consecutiveFailures=0;
 for(const entry of queue){
  if(attempted>=limit||provider==='none'||consecutiveFailures>=3||entry.reviewRequired){remaining.push(entry);continue;}
  attempted++;
  try{
   const {text,tokens}=protectText(entry.source,terms);
   const known=deterministicTranslation(entry.source);
   const value=known||restoreTranslation(entry.source,await translate(text),tokens);
   if(!known&&!publishMachine){
    remaining.push({...entry,attempts:entry.attempts+1,draft:value,reviewRequired:true,lastError:'Offline machine draft requires linguistic review'});
    records.push({id:entry.id,sourceHash:entry.sourceHash,scope:entry.scope,key:entry.key,provider,status:'draft',at:new Date().toISOString()});continue;
   }
   automatic[entry.scope]??={};
   if(!Object.hasOwn(human[entry.scope]||{},entry.key))automatic[entry.scope][entry.key]=value;
   records.push({id:entry.id,sourceHash:entry.sourceHash,scope:entry.scope,key:entry.key,provider,at:new Date().toISOString()});completed++;consecutiveFailures=0;
  }catch(error){const infrastructure=/provider failed|timeout|HTTP|unavailable/i.test(error.message);if(infrastructure)consecutiveFailures++;remaining.push({...entry,attempts:entry.attempts+1,lastError:String(error.message).slice(0,180),reviewRequired:!infrastructure&&entry.attempts>=2});}
 }
 return{remaining,completed,records};
}
