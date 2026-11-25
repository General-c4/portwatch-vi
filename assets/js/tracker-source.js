// Shared validation only: no score calculation or transformation of canonical tracker records.
export function validateTracker(data,previous){
 if(!data||typeof data!=='object'||!Number.isFinite(Date.parse(data.updated)))throw new Error('Missing tracker timestamp');
 for(const section of ['efforts','news','tools']){
  if(!Array.isArray(data[section])||(section==='efforts'&&!data[section].length))throw new Error(`Invalid or empty ${section}`);
  const seen=new Set();
  for(const item of data[section]){
   if(!item||typeof item!=='object')throw new Error(`Invalid ${section} record`);
   const id=section==='tools'?item.repo:item.id;
   if(typeof id!=='string'||!id||seen.has(id))throw new Error(`Missing or duplicate ${section} id`);seen.add(id);
   if(section==='news'&&(!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)||typeof item.title!=='string'||!Array.isArray(item.body)||item.body.some(p=>typeof p!=='string')))throw new Error('Invalid article');
   if(section==='efforts'&&typeof item.name!=='string')throw new Error('Invalid project');
  }
  if(previous?.[section]?.length>=5&&data[section].length<previous[section].length/2)throw new Error(`Suspicious mass removal in ${section}; review required`);
 }
 if(previous&&Date.parse(data.updated)<Date.parse(previous.updated))throw new Error('Refusing older tracker snapshot');
 return data;
}
export function validatePinned(data){
 if(!data||typeof data!=='object'||typeof data.text!=='string'||data.text.length>10000)throw new Error('Invalid pinned message');return data;
}
export function newerSnapshot(repository,live){
 if(!repository)return live;if(!live)return repository;
 return Date.parse(live.updated)>Date.parse(repository.updated)?live:repository;
}
