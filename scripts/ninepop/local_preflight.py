"""Offline preflight of a full disabled collection plan. No transport imports."""
import importlib.util,json
from pathlib import Path

def module(name):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def check(directory):
 p=Path(directory);integrity=module('check_staged').check(p)
 config=module('local_connection').check(p/'next-connection.json')
 bindings=json.loads((p/'account-version-bindings.json').read_text())
 if bindings.get('enabled') is not False:raise ValueError('Bindings must remain disabled')
 if bindings.get('tenantId')!=config['tenantId']:raise ValueError('Binding tenant mismatch')
 seen=set()
 for actor in bindings['accounts']:
  if not actor.get('id') or actor['id'] in seen:raise ValueError('Invalid account binding')
  seen.add(actor['id'])
 for record in bindings['records']:
  if not set(record['readerIds'])<=seen:raise ValueError('Unknown recipient')
  if record.get('enabled') is not False or record.get('sourceACLVerified') is not False:
   raise ValueError('Historical plan cannot authorize live resources')
  if not record.get('fingerprint') or not record.get('sourceSnapshot'):raise ValueError('Missing version evidence')
 return {'status':'OFFLINE_PREFLIGHT_PASS','tableCount':config['datasetCount'],
         'accounts':len(seen),'versionBindings':len(bindings['records']),
         'integrity':integrity['integrity'],'activationReady':False,'networkExecuted':False}

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();print(json.dumps(check(a.directory)))
