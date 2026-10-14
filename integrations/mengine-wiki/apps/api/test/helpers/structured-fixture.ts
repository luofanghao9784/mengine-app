import {randomUUID} from 'node:crypto';
import type {Store} from '../../src/store.js';
import type {Field} from '../../src/foundation.js';
import type {Doc,User} from '../../src/domain.js';
import {recordChecks} from '../../src/structured-governance.js';
// Synthetic test setup only. Never restore the retired content mutation APIs.
export function seedDataset(store:Store,u:User,title:string,fields:Field[],values:Record<string,string>[]=[]){
 const id=randomUUID(),at=new Date().toISOString();
 const d:Doc={id,tenantId:u.tenantId,sha:id,title,kind:'数据表',department:u.department,ownerId:u.id,uploadedBy:{id:u.id,name:u.name},classification:2,audience:'private',grants:[],tags:['结构化数据'],status:'ready',version:1,policyVersion:1,content:title,summary:'合成验收数据',originalPath:'',createdAt:at,updatedAt:at,reviewAt:'2099-01-01T00:00:00Z',quality:100,issues:[],error:null};
 store.db.transaction(()=>{
  store.saveDoc(d);store.db.prepare('INSERT INTO data_sets VALUES(?,?,?)').run(id,u.tenantId,JSON.stringify({id,fields,source:'合成验收数据',purpose:'测试业务',updatePolicy:'合成数据'}));
  const records=values.map(values=>({id:randomUUID(),version:1,values,issues:[] as string[],status:'ready',updatedAt:at,actor:u.name}));
  for(const {row,issues} of recordChecks(fields,records)){
   row.issues=issues.map(i=>i.message);row.status=issues.length?'quarantined':'ready';
   store.db.prepare('INSERT INTO data_rows VALUES(?,?,?,?,?,?)').run(row.id,id,u.tenantId,row.status,at,JSON.stringify(row));
  }
 })();return id;
}
