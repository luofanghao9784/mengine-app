#!/usr/bin/env python3
"""Read-only HTTP acceptance of a running restored developer snapshot; never prints records or credentials."""
import time, argparse, concurrent.futures, http.cookiejar, json, pathlib, urllib.error, urllib.parse, urllib.request

def verify(directory, expectations):
    root=pathlib.Path(directory)
    config=json.loads((root/'config.json').read_text())
    assert config['agentMode']=='off', 'Real models must remain off'
    base='http://127.0.0.1:'+str(config['ports']['api'])
    accounts=json.loads((root/'accounts.json').read_text())['members']
    expected=json.loads(pathlib.Path(expectations).read_text())
    prefix='/api/v1/tenants/'+expected['tenantId']
    def actor(name):
        account=next(a for a in accounts if a['display_name']==name)
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def call(path, body=None):
            headers={}
            if body is not None:
                csrf=call('/api/v1/auth/csrf');headers={csrf['headerName']:csrf['token'],'Content-Type':'application/json'}
            req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
            with opener.open(req,timeout=60) as response:return json.load(response)
        call('/api/v1/auth/login',{'phone':account['phone'],'password':account['password']})
        if name == expected['actors'][0]:
            # A restored lease can be expired. Wait for the normal local bridge worker;
            # do not bypass authorization or extend its lease in the database.
            deadline=time.monotonic()+90
            while True:
                status=call('/api/tenant-admin/v1/tenants/'+expected['tenantId']+'/scene/status')
                if status['governance']['policy_current']:
                    assert sum(x['kind']=='TABLE' for x in status['assets'])==expected['routes']
                    break
                if time.monotonic()>=deadline:raise RuntimeError('Local policy synchronization is not ready')
                time.sleep(2)
        # Customer view is available to all employees via the employee foundation endpoint.
        allowed=denied=0
        for item in expected['items']:
            permitted=name in item['readers']
            try:
                result=call(prefix+'/foundation/assets/dataset-'+item['targetId']+'/processing?limit=1')
                assert permitted and result.get('records') is not None, 'Unexpected access or missing records'
                allowed+=1
            except urllib.error.HTTPError as error:
                assert not permitted and error.code in (403,404), 'Unexpected access status: '+str(error.code)+' actor='+name+' source='+item['sourceId']+' code='+str(json.loads(error.read()).get('code'))
                denied+=1
        return allowed,denied
    results=[actor(expected['actors'][0])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results.extend(pool.map(actor,expected['actors'][1:]))
    result={'actors':len(results),'checks':sum(sum(x) for x in results),'allowed':sum(x[0] for x in results),'denied':sum(x[1] for x in results),'realModelEnabled':False}
    print(json.dumps(result))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',required=True);p.add_argument('--expectations',required=True);a=p.parse_args();verify(a.directory,a.expectations)
