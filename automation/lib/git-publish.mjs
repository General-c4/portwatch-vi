import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const run=(args,cwd)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:10000000}).trim();
const verifyTree=cwd=>{const tests=run(['ls-files','tests/*.test.mjs'],cwd).split('\n').filter(Boolean);if(!tests.length)throw Error('Missing regression tests');execFileSync(process.execPath,['--test',...tests],{cwd,windowsHide:true,stdio:'inherit'});};
export function publishCommit({cwd=process.cwd(),remote='origin',branch='feat/arabic-rtl-localization',verify=verifyTree}={}){
 if(!/^[\w.-]+$/.test(remote)||!/^[-\w./]+$/.test(branch)||branch.startsWith('-'))throw Error('Invalid publication target');
 for(let attempt=0;attempt<3;attempt++){
  const before=run(['rev-parse','HEAD'],cwd);run(['fetch',remote,branch],cwd);
  try{run(['rebase','FETCH_HEAD'],cwd);}catch{try{run(['rebase','--abort'],cwd);}catch{}throw Error('Publication requires conflict review; validated checkpoint is retained');}
  if(run(['rev-parse','HEAD'],cwd)!==before)verify(cwd);
  try{run(['push',remote,`HEAD:refs/heads/${branch}`],cwd);return run(['rev-parse','HEAD'],cwd);}catch{if(attempt===2)throw Error('Concurrent branch updates prevented publication; validated checkpoint is retained');}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({publishedCommit:publishCommit()}));
