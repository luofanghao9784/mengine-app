#!/usr/bin/env python3
"""Manage the prepared local-only Langfuse deployment without printing credentials."""
import argparse,json,os,subprocess,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SERVICE=ROOT/'.local/langfuse'
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['start','stop','status']);a=p.parse_args()
 if a.command=='status':
  try:
   with urllib.request.urlopen('http://127.0.0.1:54640/api/public/health',timeout=5) as r: print('Langfuse health HTTP',r.status)
  except Exception:print('Langfuse health unavailable');return 1
  return 0
 env=dict(os.environ,DOCKER_HOST='unix://'+str(Path.home()/'.colima/default/docker.sock'))
 env['PATH']=os.pathsep.join(str(SERVICE/x) for x in ['bin','runtime/bin','runtime/docker'])+os.pathsep+env.get('PATH','')
 if a.command=='start':
  ready=subprocess.run([str(SERVICE/'bin/colima'),'status'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if ready.returncode:
   code=subprocess.call([str(SERVICE/'bin/colima'),'start'],env=env)
   if code:return code
 command=[str(SERVICE/'bin/docker-compose'),'--project-directory',str(SERVICE),'-f',str(SERVICE/'compose.yml')]
 command+=['up','-d'] if a.command=='start' else ['stop']
 return subprocess.call(command,env=env)
if __name__=='__main__':raise SystemExit(main())
