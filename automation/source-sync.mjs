import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {atomicJSON,readJSON,log} from './lib/state.mjs';
import {classifySourceChanges} from './lib/source-policy.mjs';
const run=(cmd,args,cwd=process.cwd())=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,maxBuffer:10_000_000}).trim();
const git=(args,cwd)=>run('git',args,cwd);
const target=process.env.PW_TARGET_BRANCH||'feat/arabic-rtl-localization';
const repo=process.env.GITHUB_REPOSITORY||'General-c4/portwatch-vi';
if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||repo==='4lwayz/portwatch-vi')throw new Error('Source automation only operates on the Arabic fork');
const state=await readJSON('automation/state/source.json',{integratedUpstreamSha:'bc768b4b1b0c45b526a6404adb083c6004be9e5b'});
git(['fetch','https://github.com/4lwayz/portwatch-vi.git','main']);const upstream=git(['rev-parse','FETCH_HEAD']);
if(!/^[a-f0-9]{40}$/.test(upstream))throw new Error('Invalid upstream SHA');
const paths=git(['diff','--name-only',state.integratedUpstreamSha,upstream]).split('\n').filter(Boolean);
const numstat=git(['diff','--numstat',state.integratedUpstreamSha,upstream,'--','.',':(exclude)data/**']);
const lines=numstat.split('\n').reduce((n,line)=>n+line.split('\t').slice(0,2).reduce((a,x)=>a+(Number(x)||0),0),0);
const policy=classifySourceChanges(paths,lines);
if(process.argv.includes('--check-only')){
 await atomicJSON('.sync/source-status.json',{...state,checkedUpstreamSha:upstream,status:policy.source.length?'source-changes-detected':'no-source-changes',...policy});
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`source_changed=${policy.source.length>0}\n`);
 log('source-plan',{upstream,files:policy.source,review:policy.reviewRequired});process.exit(0);
}
if(!policy.source.length){await atomicJSON('.sync/source-status.json',{...state,checkedUpstreamSha:upstream,status:'no-source-changes'});process.exit(0);}
const branch=`sync/upstream-${upstream.slice(0,12)}`,work=resolve(`.sync/integration-${upstream.slice(0,12)}`);
await mkdir('.sync',{recursive:true});
const existing=git(['ls-remote','--heads','origin',`refs/heads/${branch}`]);
if(existing){await atomicJSON('.sync/source-status.json',{...state,checkedUpstreamSha:upstream,status:'review-required',branch,reason:'Existing integration requires conflict review'});if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'review_required=true\n');log('source-review-already-staged',{branch,upstream});process.exit(0);}
git(['worktree','add','-b',branch,work,'HEAD']);
let conflicts=[];
try{
 // Establish ancestry without overwriting current data, then apply only the upstream source patch.
 git(['-c','user.name=portwatch-sync[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','merge','--no-commit','--no-ff','-s','ours',upstream],work);
 const patch=run('git',['diff','--binary',state.integratedUpstreamSha,upstream,'--','.',':(exclude)data/**']);
 const patchFile=resolve('.sync/upstream.patch');await writeFile(patchFile,patch+'\n');
 try{git(['apply','--3way','--index',patchFile],work);}catch{
  conflicts=git(['diff','--name-only','--diff-filter=U'],work).split('\n').filter(Boolean);
  // Keep Arabic on conflicted files and retain the full patch for human review in a draft PR.
  for(const path of conflicts){git(['checkout','--ours','--',path],work);git(['add','--',path],work);}
  if(!conflicts.length)policy.reasons.push('Patch could not be applied cleanly');
 }
 const blocked=policy.reviewRequired||conflicts.length>0||policy.reasons.length>0;
 await mkdir(`${work}/automation/review`,{recursive:true});
 await atomicJSON(`${work}/automation/review/upstream.json`,{upstream,base:state.integratedUpstreamSha,files:policy.source,conflicts,reasons:policy.reasons,reviewRequired:blocked});
 if(blocked)await writeFile(`${work}/automation/review/upstream.patch`,patch+'\n');
 else await atomicJSON(`${work}/automation/state/source.json`,{integratedUpstreamSha:upstream,integratedAt:new Date().toISOString()});
 git(['add','automation'],work);
 git(['-c','user.name=portwatch-sync[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m',`sync: stage upstream ${upstream.slice(0,12)}${blocked?' for review':''}`],work);
 let passed=false;
 if(!blocked){
  try{
   // Node tests run in the integration tree. Browser verification is mandatory before auto integration.
   run(process.execPath,['--test',...git(['ls-files','tests/*.test.mjs'],work).split('\n')],work);
   if(process.env.PW_SOURCE_BROWSER_CHECK!=='1')throw new Error('Browser gate is required');
   run(process.execPath,[resolve('automation/verify-source-browser.mjs'),work],process.cwd());passed=true;
  }catch(error){policy.reasons.push(`Regression gate failed: ${String(error.message).slice(0,180)}`);}
 }
 if(passed){
  // Fast-forward only. A concurrent change causes failure instead of overwriting Arabic work.
  git(['push','origin',`HEAD:refs/heads/${target}`],work);await atomicJSON('.sync/source-status.json',{integratedUpstreamSha:upstream,status:'integrated',integratedAt:new Date().toISOString()});log('source-integrated',{upstream,branch});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'integrated=true\n');
 }else{
  await atomicJSON(`${work}/automation/review/upstream.json`,{upstream,base:state.integratedUpstreamSha,files:policy.source,conflicts,reasons:policy.reasons,reviewRequired:true});
  await writeFile(`${work}/automation/review/upstream.patch`,patch+'\n');
  git(['add','automation/review'],work);
  git(['-c','user.name=portwatch-sync[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','--allow-empty','-m','sync: require review before deploying staged source'],work);
  git(['push','origin',branch],work);
  const body=`Upstream commit: ${upstream}\n\nArabic files are preserved. Conflicts: ${conflicts.join(', ')||'none'}.\n\n${policy.reasons.join('\n')}\n\nReview automation/review/upstream.json and upstream.patch. This draft is in the fork only and must not deploy until resolved and validated.`;
  const bodyFile=resolve('.sync/source-pr.md');await writeFile(bodyFile,body);
  let pr=null,prError=null;
  try{pr=run('gh',['pr','create','--repo',repo,'--base',target,'--head',branch,'--draft','--title',`sync: review upstream ${upstream.slice(0,12)}`,'--body-file',bodyFile]);}
  catch(error){prError=String(error.stderr||error.message).slice(0,500);}
  await atomicJSON('.sync/source-status.json',{checkedUpstreamSha:upstream,status:'review-required',branch,pr,prError,conflicts,reasons:policy.reasons});
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'review_required=true\n');
  log('source-review-required',{branch,pr,prError});
 }
}finally{git(['worktree','remove',work]);}
