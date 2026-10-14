import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import type {Store} from '../src/store.js';
import {initializeSourceLeases,acquireSourceLease,sourceBusy} from '../src/source-lease.js';

test('独立数据库连接互斥、企业隔离、租约过期接管和旧执行者发布拒绝',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'source-lease-')),path=join(dir,'lease.sqlite');
 const a={db:new Database(path)} as Store,b={db:new Database(path)} as Store;
 try{
  initializeSourceLeases(a);initializeSourceLeases(b);
  const first=acquireSourceLease(a,'tenant-a','connection:1');
  assert.equal(sourceBusy(b,'tenant-a','connection:1'),true);
  assert.throws(()=>acquireSourceLease(b,'tenant-a','connection:1'),{statusCode:409});
  const otherTenant=acquireSourceLease(b,'tenant-b','connection:1');otherTenant.assert();otherTenant.release();
  a.db.prepare('UPDATE source_leases SET expires=0 WHERE tenant_id=?').run('tenant-a');
  const replacement=acquireSourceLease(b,'tenant-a','connection:1');
  assert.throws(()=>first.assert(),{statusCode:409});
  first.release();replacement.assert(); // An expired owner cannot release a successor.
  replacement.release();assert.equal(sourceBusy(a,'tenant-a','connection:1'),false);
  const next=acquireSourceLease(a,'tenant-a','connection:1');next.assert();next.release();
 }finally{a.db.close();b.db.close();await rm(dir,{recursive:true,force:true});}
});
test('异常退出后执行凭据仍持久化，过期后可恢复，不依赖内存 busy 状态',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'source-crash-')),path=join(dir,'lease.sqlite');
 const first={db:new Database(path)} as Store;initializeSourceLeases(first);acquireSourceLease(first,'tenant','job:1');first.db.close();
 const restarted={db:new Database(path)} as Store;
 try{
  initializeSourceLeases(restarted);assert.throws(()=>acquireSourceLease(restarted,'tenant','job:1'),{statusCode:409});
  restarted.db.prepare('UPDATE source_leases SET expires=0').run();
  const recovered=acquireSourceLease(restarted,'tenant','job:1');recovered.assert();recovered.release();
 }finally{restarted.db.close();await rm(dir,{recursive:true,force:true});}
});
