"""Offline integrity check only; never registers or activates a provider."""
import hashlib
import json
from pathlib import Path

def check(directory):
 root=Path(directory);r=json.loads((root/'readiness.json').read_text())
 if r.get('status')!='STAGED_DISABLED_NOT_REGISTERED':raise ValueError('Staging state required')
 if any(r.get(k) is not False for k in ['networkExecuted','realCollectionExecuted','existingInstallationChanged']):raise ValueError('Offline boundaries required')
 x=json.loads((root/'approved-extension.json').read_text())
 if any(x.get(k) is not False for k in ['enabled','cloudApplied','realCollectionAllowed','addReaders','originalDownloadAllowed']):raise ValueError('Extension must remain disabled')
 # addReaders means expanding past the approved audience, not confirmation of its names.
 hashes=r.get('stagedCodeHashes',{})
 if not hashes:raise ValueError('Missing file inventory')
 for name,expected in hashes.items():
  if Path(name).name!=name:raise ValueError('Invalid staged path')
  p=root/'runtime'/name
  if p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise ValueError('Staged file changed')
 return {'integrity':'PASS','activationReady':False,'filesVerified':len(hashes),'networkExecuted':False,'blockers':r.get('blockers',[])}

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();print(json.dumps(check(a.directory),ensure_ascii=False))
