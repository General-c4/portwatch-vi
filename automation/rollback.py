"""Recover the previous tested Pages artifact; never invent a green result for a failed new release."""
import json,os,pathlib,subprocess,tarfile
root=pathlib.Path('.sync/rollback');root.mkdir(parents=True,exist_ok=True)
repo=os.environ['GITHUB_REPOSITORY']
runs=json.loads(subprocess.check_output(['gh','run','list','--repo',repo,'--workflow','arabic-preview.yml','--status','success','--limit','5','--json','databaseId,headSha']))
if not runs:raise RuntimeError('No previous successful deployment to recover')
subprocess.run(['gh','run','download',str(runs[0]['databaseId']),'--repo',repo,'--name','github-pages','--dir',str(root/'download')],check=True)
target=(root/'site').resolve();target.mkdir(exist_ok=True)
with tarfile.open(root/'download'/'artifact.tar') as archive:
    for item in archive.getmembers():
        destination=(target/item.name).resolve()
        if not destination.is_relative_to(target) or item.issym() or item.islnk():raise ValueError('Unsafe rollback artifact')
    archive.extractall(target,filter='data')
metadata=json.loads((target/'deployment.json').read_text())
print(json.dumps({'rollbackCommit':metadata['commit'],'sourceRun':runs[0]['databaseId']}))
