// Shared, explicit scope for translation, coverage and rendering. No numerical/machine fields.
export const changeRecordId=c=>`change:${c.id||`${c.date}:${c.kind}:${c.text}`}`;
export function projectTextFields(e){
 const fields={};
 for(const key of ['summary','description','approach','target','byline','evidence','provenOn'])if(typeof e[key]==='string'&&e[key])fields[key]=e[key];
 for(const key of ['highlights','blockers'])for(const [i,text]of(e[key]||[]).entries())if(typeof text==='string'&&text)fields[`${key}.${i}`]=text;
 for(const [i,c]of(e.claims||[]).entries())if(typeof c.text==='string'&&c.text)fields[`claims.${i}.text`]=c.text;
 if(typeof e.proof?.label==='string'&&e.proof.label)fields['proof.label']=e.proof.label;
 return fields;
}
export function dynamicEditorialRecords(data){
 const headlines=(data.headlines||[]).filter(h=>typeof h.link==='string'&&/^https:\/\//.test(h.link)&&typeof h.title==='string').map(h=>({id:`headline:${h.link}`,section:'headlines',date:h.date,fields:{title:h.title,...(typeof(h.summary||h.dek)==='string'?{summary:h.summary||h.dek}:{})},sourceUrls:[h.link]}));
 const changes=[...(data.changes||[])].reverse().slice(0,12).filter(c=>typeof c.text==='string'&&c.text).map(c=>({id:changeRecordId(c),section:'changes',date:c.date,fields:{text:c.text},sourceUrls:[]}));
 const projects=(data.efforts||[]).filter(e=>e.id&&['tracked','watchlist'].includes(e.tier)&&!e.nuked).map(e=>({id:`project:${e.id}`,section:'projects',projectId:e.id,fields:projectTextFields(e),sourceUrls:[e.repo?`https://github.com/${e.repo}`:null,e.proof?.url].filter(Boolean)}));
 return [...headlines,...changes,...projects];
}
export function resolvedLegacyReferences(data,catalogs){
 const result=new Set();
 for(const record of dynamicEditorialRecords(data))for(const[field,source]of Object.entries(record.fields)){
  if(!isTechnicalLiteral(source)&&scopedTranslation(source,record.id,field,catalogs).method==='fallback')continue;
  const refs=record.section==='projects'?[`efforts:${record.projectId}.${field}`]:record.section==='headlines'?[`headlines:${record.id.slice('headline:'.length)}.${field}`,...(field==='summary'?[`headlines:${record.id.slice('headline:'.length)}.dek`]:[])]:data.changes.flatMap((c,i)=>changeRecordId(c)===record.id?[`changes.${i}.text`]:[]);
  for(const ref of refs)result.add(`${ref}\0${source}`);
 }
 return result;
}
export function scopedTranslation(source,id,field,{human={},automatic={},catalog={}}={}){
 if(Object.hasOwn(human,source)&&typeof human[source]==='string')return{value:human[source],method:'reviewed'};
 const entry=catalog.articles?.[id]?.fields?.[field];
 if(entry?.source===source&&typeof entry.ar==='string'&&entry.ar.trim())return{value:entry.ar,method:'gemini'};
 if(Object.hasOwn(automatic,source)&&typeof automatic[source]==='string')return{value:automatic[source],method:'automatic'};
 return{value:source,method:'fallback'};
}
const technicalOnly=new Set(['GTA VI','GTA 6','Rust','C++','C#','Go','Python','Unicorn','Unreal Engine','Unity','Xbox Series X|S','Xbox Series','Windows','Linux','macOS','NVIDIA','AMD','Intel','Vulkan','DirectX 12']);
export const isTechnicalLiteral=source=>technicalOnly.has(source);
export function editorialCoverage(data,catalogs){
 const sections={};const missing=[],entries=[];
 for(const record of dynamicEditorialRecords(data))for(const[field,source]of Object.entries(record.fields)){
  const section=record.section==='projects'?(field==='summary'||field==='description'?'projectDescriptions':field.startsWith('highlights.')?'highlights':field.startsWith('blockers.')?'blockers':'projectDetails'):record.section;
  const translation=scopedTranslation(source,record.id,field,catalogs),exempt=isTechnicalLiteral(source);
  const item={id:record.id,field,section,source,translated:!exempt&&translation.method!=='fallback',exempt,method:translation.method,value:translation.value};entries.push(item);
  sections[section]??={total:0,translated:0,exempt:0,missing:0};const s=sections[section];s.total++;exempt?s.exempt++:item.translated?s.translated++:s.missing++;
  if(!item.translated&&!exempt)missing.push(item);
 }
 for(const s of Object.values(sections))s.coverage=s.total===s.exempt?100:Math.round(s.translated/(s.total-s.exempt)*10000)/100;
 return{sections,total:entries.length,translated:entries.filter(e=>e.translated).length,exempt:entries.filter(e=>e.exempt).length,missing,entries};
}
