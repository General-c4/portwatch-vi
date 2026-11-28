import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishCommit} from '../automation/lib/git-publish.mjs';
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:'pipe'}).trim();
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'pw-publish-')),remote=join(root,'remote.git'),human=join(root,'human'),bot=join(root,'bot');
 git(root,['init','--bare',remote]);git(root,['clone',remote,human]);git(human,['config','core.autocrlf','false']);git(human,['config','user.name','Fixture']);git(human,['config','user.email','fixture@example.test']);git(human,['checkout','-b','feature']);
 await writeFile(join(human,'data.json'),'base\n');git(human,['add','.']);git(human,['commit','-m','base']);git(human,['push','origin','feature']);git(root,['clone','--branch','feature',remote,bot]);git(bot,['config','core.autocrlf','false']);git(bot,['config','user.name','Fixture']);git(bot,['config','user.email','fixture@example.test']);
 return {root,human,bot};
}
test('a concurrent human documentation commit is preserved and the combined tree is verified before fast-forward publication',async()=>{
 const {human,bot}=await setup();await writeFile(join(bot,'data.json'),'validated translation\n');git(bot,['commit','-am','translation']);
 await writeFile(join(human,'README.md'),'new documentation\n');git(human,['add','.']);git(human,['commit','-m','docs']);git(human,['push','origin','feature']);let verified=0;
 publishCommit({cwd:bot,branch:'feature',verify:()=>verified++});assert.equal(verified,1);git(human,['pull','--ff-only','origin','feature']);assert.equal(await readFile(join(human,'data.json'),'utf8'),'validated translation\n');assert.equal(await readFile(join(human,'README.md'),'utf8'),'new documentation\n');
});
test('a real same-field conflict fails safely and retains the unpublished validated commit',async()=>{
 const {human,bot}=await setup();await writeFile(join(bot,'data.json'),'validated Arabic\n');git(bot,['commit','-am','translation']);const saved=git(bot,['rev-parse','HEAD']);
 await writeFile(join(human,'data.json'),'new authoritative content\n');git(human,['commit','-am','human update']);git(human,['push','origin','feature']);
 assert.throws(()=>publishCommit({cwd:bot,branch:'feature',verify:()=>{}}),/conflict review/);assert.equal(git(bot,['rev-parse','HEAD']),saved);assert.equal(await readFile(join(bot,'data.json'),'utf8'),'validated Arabic\n');
});
