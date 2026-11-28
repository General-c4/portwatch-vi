import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicOperations} from '../automation/lib/api-anything.mjs';
test('API Anything 0.5 site wrapper is validated before calls and after healing',()=>{
 const op={readOnly:true,request:{method:'GET',url:'https://portwatch-vi.xyz/data/tracker.json'}};
 assert.equal(validatePublicOperations({site:{operations:[op]},source:'user'}).operations[0],op);
 for(const loaded of [{operations:[op]},{site:{operations:[]}},{site:{operations:[{...op,readOnly:false}]}},{site:{operations:[{...op,request:{...op.request,method:'POST'}}]}},...['http://portwatch-vi.xyz/data/tracker.json','https://other.example/data/tracker.json','https://token@portwatch-vi.xyz/data/tracker.json'].map(url=>({site:{operations:[{...op,request:{method:'GET',url}}]}}))])assert.throws(()=>validatePublicOperations(loaded));
});
