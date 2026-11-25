// Inventory editorial display fields only. Identifiers, source URLs, credits, code languages and
// machine-readable categories stay canonical. The map uses complete English source strings as keys.
const fields = new Set(['title','dek','summary','approach','target','byline','evidence','desc','description','text','lastSummary','note','label']);
const arrays = new Set(['body','highlights','blockers','signals','sources']);
const sections = ['news','efforts','tools','candidates','changes','scout','exe','headlines'];
const preserved = new Set(['Rust','C++','Go','NotRexed (@ItsNotRexed)','GTA VI']);
export function contentInventory(data) {
 const result=[];
 const visit=(value,path,field)=>{
  if(typeof value==='string') {
   if((fields.has(field)||arrays.has(field)) && value && !preserved.has(value))result.push({path,source:value});
  } else if(Array.isArray(value)) value.forEach((v,i)=>visit(v,`${path}.${i}`,field));
  else if(value && typeof value==='object') for(const [key,v] of Object.entries(value)) {
   // kind is descriptive for tools, a machine enum in the change feed and candidate list.
   if(key==='kind' && path.startsWith('tools.'))result.push({path:`${path}.kind`,source:v});
   else visit(v,`${path}.${key}`,key);
  }
 };
 for(const section of sections)visit(data[section],section,section);
 return result;
}
