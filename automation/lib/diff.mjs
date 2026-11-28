import {hash} from './state.mjs';
export function recordDiff(before={},after={}){
 const result={new:0,updated:0,deleted:0,sections:{}};
 for(const section of new Set([...Object.keys(before),...Object.keys(after)])){
  if(!Array.isArray(before[section])&&!Array.isArray(after[section]))continue;
  const key=item=>item?.id||item?.repo||item?.link||hash(item);
  const a=new Map((before[section]||[]).map(v=>[key(v),hash(v)])),b=new Map((after[section]||[]).map(v=>[key(v),hash(v)]));
  const delta={new:0,updated:0,deleted:0};
  for(const [id,value]of b){if(!a.has(id))delta.new++;else if(a.get(id)!==value)delta.updated++;}
  for(const id of a.keys())if(!b.has(id))delta.deleted++;
  result.sections[section]=delta;for(const k of ['new','updated','deleted'])result[k]+=delta[k];
 }
 return result;
}
