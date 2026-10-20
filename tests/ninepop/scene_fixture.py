"""Synthetic data only, used by the real Java registration/reading integration test."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/ninepop'))
from scoped_scene_export import export

def fixture(tenant, boss, manager, version='1'):
    bundle={'tenantId':tenant,'snapshot':{'id':'synthetic-'+version,'version':3 if version=='revoked' else int(version)},'rows':{
      'facts':[{'id':'a','store':'A','amount':100 if version=='1' else 200},
               {'id':'b','store':'B','amount':900}],
      'history':[{'id':'unknown','date':'2020-01-01','amount':777}], 'assignments':[]}}
    rules={p:{'reviewed':True,'kind':'store_role','table':'facts','topic':p,
           'storeColumn':'store','columns':['id','amount']} for p in ['salary','dividend']}
    rules['history']={'reviewed':True,'kind':'historical','table':'history','topic':'salary',
       'columns':['id','amount'],'policies':{'history':{'kind':'unresolved'}}}
    grants={boss:{'salary':['A','B'],'dividend':['A','B']},manager:{'salary':['A']}}
    if version=='revoked':grants[manager]={}
    scopes=[{'id':'salary-a','purpose':'salary','store':'A'},
            {'id':'salary-b','purpose':'salary','store':'B'},
            {'id':'dividend-a','purpose':'dividend','store':'A'},
            {'id':'history-unknown','purpose':'history','store':'A'}]
    return export(bundle,rules,grants,scopes,tenant)
if __name__=='__main__':print(json.dumps(fixture(*sys.argv[1:])))
