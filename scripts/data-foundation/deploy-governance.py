#!/usr/bin/env python3
"""Signed deployment operator client. Reads private config; no browser credentials or raw SQL."""
import argparse,hashlib,hmac,json,os,secrets,stat,urllib.request,urllib.parse
from pathlib import Path

def private(path):
 p=Path(path)
 if p.is_symlink() or not p.is_file() or p.stat().st_uid!=os.getuid() or p.stat().st_mode&0o077:raise ValueError('Configuration must be an owned private 0600 regular file')
 return json.loads(p.read_text())
def request(config,action,body):
 if action not in ['context','preview','apply','source']:raise ValueError('Unknown deployment action')
 url=urllib.parse.urlparse(config['url'])
 if url.scheme!='https' and not(url.scheme=='http' and url.hostname in ['127.0.0.1','localhost','::1']):raise ValueError('Remote deployment requires HTTPS')
 if url.username or url.password:raise ValueError('Credentials must not be embedded in URL')
 if len(config['key'])<32:raise ValueError('Invalid deployment key')
 import base64,time
 payload=base64.urlsafe_b64encode(json.dumps({'tenant':config['tenant'],'actor':'deployment:codex','nonce':secrets.token_hex(24),'at':int(time.time()*1000),'method':'POST','path':'/deployment-governance/'+action,'body':body},ensure_ascii=False).encode()).decode().rstrip('=')
 data=json.dumps({'payload':payload,'signature':hmac.new(config['key'].encode(),payload.encode(),hashlib.sha256).hexdigest()}).encode()
 if len(data)>1000000:raise ValueError('Deployment package exceeds bounded request size')
 req=urllib.request.Request(config['url'],data=data,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['context','preview','apply','source']);p.add_argument('--config',required=True);p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 result=request(private(a.config),a.action,json.loads(Path(a.input).read_text()))
 fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:json.dump(result,f,ensure_ascii=False,indent=2)
 print('Deployment response saved to private output file')
if __name__=='__main__':main()
