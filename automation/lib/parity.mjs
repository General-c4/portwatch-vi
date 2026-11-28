import {hash} from './state.mjs';
import {validateTracker} from '../../assets/js/tracker-source.js';

// Hash the complete canonical object, including future sections and nested unknown fields.
export function canonicalSummary(data){
 validateTracker(data);
 return {updated:data.updated,hash:hash(data),sections:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,{hash:hash(value),...(Array.isArray(value)?{count:value.length}:{})}]))};
}
export function verifyParity(snapshot,deployed,latest=snapshot){
 const expected=canonicalSummary(snapshot),actual=canonicalSummary(deployed),current=canonicalSummary(latest);
 if(expected.hash!==actual.hash)throw new Error('Production canonical snapshot differs from the synchronized upstream snapshot');
 const advanced=Date.parse(current.updated)>Date.parse(expected.updated);
 if(!advanced&&current.hash!==actual.hash)throw new Error('Production canonical data differs from current official data');
 return {snapshotParity:true,latestParity:current.hash===actual.hash,upstreamAdvancedDuringDeployment:advanced,snapshot:expected,deployed:actual,latest:current,lagMs:Math.max(0,Date.parse(current.updated)-Date.parse(actual.updated))};
}
