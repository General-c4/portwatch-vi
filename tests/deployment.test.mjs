import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {hash} from '../automation/lib/state.mjs';
test('deployment verifier fails on a bad release and recovers from stale CDN metadata without a false success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pw-deploy-'));await mkdir(join(root,'_site/data'),{recursive:true});
 const tracker={updated:'2026-11-25T10:00:00Z',efforts:[{id:'project',name:'Project'}],tools:[],news:[]};
 await writeFile(join(root,'_site/data/tracker.json'),JSON.stringify(tracker));
 const metadata={commit:'a'.repeat(40),dataHash:hash(tracker),builtAt:new Date().toISOString()};
 await writeFile(join(root,'_site/deployment.json'),JSON.stringify(metadata));
 let mode='fail',requests=0;
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/deployment.json')){requests++;if(mode==='fail'){res.writeHead(503);res.end('temporary failure');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mode==='recover'&&requests===1?{...metadata,commit:'b'.repeat(40)}:metadata));return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.startsWith('/data/tracker.json')?tracker:{}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const check=()=>new Promise(resolveResult=>{
  const child=spawn(process.execPath,[resolve('automation/verify-deployment.mjs')],{cwd:root,env:{...process.env,PW_SITE_URL:`http://127.0.0.1:${server.address().port}/`,PW_VERIFY_RETRY_MS:'5',PW_UPSTREAM_TRACKER_URL:`http://127.0.0.1:${server.address().port}/data/tracker.json`},stdio:'ignore',windowsHide:true});child.on('exit',resolveResult);
 });
 try{
  assert.notEqual(await check(),0);assert.equal(JSON.parse(await readFile(join(root,'.sync/deployment-status.json'))).status,'failure');
  assert.equal(JSON.parse(await readFile(join(root,'_site/deployment.json'))).commit,metadata.commit);
  mode='recover';requests=0;assert.equal(await check(),0);assert.equal(JSON.parse(await readFile(join(root,'.sync/deployment-status.json'))).status,'success');assert.equal(requests,2);
 }finally{await new Promise(r=>server.close(r));}
});
