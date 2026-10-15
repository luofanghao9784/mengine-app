import test from 'node:test';
import assert from 'node:assert/strict';
import {exportGovernance,governDerivedAssets} from '../src/platform-governance.js';
import type {Store} from '../src/store.js';
import type {User,Doc} from '../src/domain.js';
test('source policy changes revoke mapped actors and cannot grant foreign or inactive identities',()=>{
 const admin={id:'admin',tenantId:'t1',role:'admin',active:true,clearance:3} as User;
 const member={id:'member',tenantId:'t1',role:'member',active:true,clearance:1} as User;
 const foreign={...member,id:'foreign',tenantId:'t2'};
 const disabled={...member,id:'disabled',active:false};
 const users=[admin,member,foreign,disabled];
 const store={user:(id:string)=>users.find(u=>u.id===id),db:{prepare:()=>({all:()=>users.map(u=>({actor_id:u.id,user_id:u.id}))})}} as unknown as Store;
 const doc={id:'doc',tenantId:'t1',kind:'资料',status:'ready',version:1,policyVersion:1,classification:1,audience:'organization',ownerId:'admin',grants:[]} as unknown as Doc;
 const before=exportGovernance(store,'enterprise','service',admin,doc);
 assert.deepEqual(before.allowedActors,['admin','member','service']);
 assert.deepEqual(before,exportGovernance(store,'enterprise','service',admin,doc));
 doc.audience='private';doc.policyVersion++;
 const after=exportGovernance(store,'enterprise','service',admin,doc);
 assert.deepEqual(after.allowedActors,['admin','service']);assert.notEqual(after.policyDigest,before.policyDigest);
 doc.aiPaused=true;assert.deepEqual(exportGovernance(store,'enterprise','service',admin,doc).allowedActors,[]);
});
test('derived policies require every source and intersect their readers',()=>{
 const a={id:'a',governance:{allowedActors:['a','b'],classification:1,policyDigest:'a1'}};
 const b={id:'b',governance:{allowedActors:['b','c'],classification:2,policyDigest:'b1'}};
 const output=governDerivedAssets([a,b,{id:'sum',sourceBasis:[{id:'a'},{id:'b'}],version:1},{id:'missing',sourceBasis:[{id:'absent'}]}]);
 assert.deepEqual(output[2].governance.allowedActors,['b']);assert.equal(output[2].governance.classification,2);
 assert.deepEqual(output[3].governance.allowedActors,[]);
});
