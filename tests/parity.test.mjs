import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyParity} from '../automation/lib/parity.mjs';
import {recordDiff} from '../automation/lib/diff.mjs';
const base=()=>({updated:'2026-11-28T04:10:21Z',efforts:[{id:'a',name:'A',score:90}],news:[],tools:[],futureSection:[{id:'new',nested:{authoritative:true}}]});
test('complete canonical parity detects stale scores, deletions and unknown future schema fields',()=>{
 const original=base();assert.equal(verifyParity(original,structuredClone(original)).latestParity,true);
 for(const change of [d=>d.efforts[0].score=20,d=>d.efforts.push({id:'b',name:'B'}),d=>d.efforts=[],d=>delete d.futureSection,d=>d.futureSection[0].nested.authoritative=false]){
  const altered=structuredClone(original);change(altered);assert.throws(()=>verifyParity(original,altered));
 }
 const next=base();next.futureSection.push({id:'b'});assert.equal(recordDiff(original,next).sections.futureSection.new,1);
});
test('an upstream advance during deployment is recorded separately from frozen release parity',()=>{
 const frozen=base(),latest=base();latest.updated='2026-11-28T05:10:21Z';latest.efforts[0].score=91;
 const report=verifyParity(frozen,frozen,latest);assert.equal(report.snapshotParity,true);assert.equal(report.latestParity,false);assert.equal(report.lagMs,3600000);
 assert.throws(()=>verifyParity(frozen,frozen,{...frozen,futureSection:[]}));
});
