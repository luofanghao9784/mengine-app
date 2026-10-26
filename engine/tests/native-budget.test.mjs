import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongTaskBudget, usageCost, LONG_TASK_POLICY } from '../dist/native/budget.js';
const scope = { tenant: 'tenant-a', user: 'user-a', task: 'task-a' };
const price = { version: 'synthetic-only', input: 1_000_000, output: 1_000_000,
  cacheRead: 100_000, cacheWrite: 2_000_000, reasoningIncluded: true };
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dh-budget-')), path = join(dir, 'budget.sqlite');
  try { fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('cache accounting is disjoint, rounds upwards and includes reasoning only once', () => {
  assert.equal(usageCost({inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:40,reasoningTokens:10}, price), 113);
  assert.equal(usageCost({inputTokens:1,outputTokens:0}, {...price,input:1}),1);
  assert.throws(()=>usageCost({inputTokens:1,outputTokens:1},{...price,reasoningIncluded:false}),{code:'MODEL_PRICE_UNVERIFIED'});
  assert.throws(()=>usageCost({inputTokens:1,outputTokens:1,reasoningTokens:2},price),{code:'MODEL_USAGE_INVALID'});
});
test('reservation is shared by independent connections and survives restart/unknown usage', () => fixture(path => {
  const a=new LongTaskBudget(path), b=new LongTaskBudget(path);
  a.reserve(scope,'first',1_500_000,1_000_000,price); // 4 yuan conservative reservation
  assert.throws(()=>b.reserve(scope,'second',500_000,1,price),{code:'TASK_COST_BUDGET'});
  a.settle(scope,'first',null); a.close(); b.close();
  const c=new LongTaskBudget(path);
  assert.equal(c.snapshot(scope).task,4_000_000);
  assert.throws(()=>c.reserve(scope,'first',1,1,price),{code:'MODEL_CALL_ALREADY_RESERVED'});
  c.settle(scope,'first',{inputTokens:10,outputTokens:10});
  c.settle(scope,'first',{inputTokens:10,outputTokens:10});
  assert.equal(c.snapshot(scope).task,20);
  assert.throws(()=>c.settle(scope,'first',{inputTokens:20,outputTokens:10}),{code:'BUDGET_RECEIPT_CONFLICT'});
  assert.throws(()=>c.settle({...scope,tenant:'tenant-b'},'first',null),{code:'BUDGET_ACCESS_DENIED'});
  c.close();
}));
test('daily cap spans tasks and pending yesterday costs, but isolates users and tenants', () => fixture(path => {
  let time=Date.parse('2026-10-26T15:59:00Z'); const db=new LongTaskBudget(path,()=>time);
  for(let i=0;i<4;i++) db.reserve({...scope,task:`task-${i}`},`call-${i}`,2_000_000,1_000_000,price);
  assert.throws(()=>db.reserve(scope,'over',1,1,price),{code:'DAILY_COST_BUDGET'});
  time=Date.parse('2026-10-26T16:01:00Z');
  assert.equal(db.snapshot(scope).day,'2026-10-27');
  assert.throws(()=>db.reserve(scope,'over-next-day',1,1,price),{code:'DAILY_COST_BUDGET'});
  db.reserve({...scope,user:'user-b'},'another-user',1,1,price);
  db.reserve({...scope,tenant:'tenant-b'},'another-tenant',1,1,price);
  db.settle({...scope,task:'task-0'},'call-0',{inputTokens:1,outputTokens:1});
  db.reserve(scope,'after-settlement',1,1,price);
  db.close();
}));
test('soft threshold does not close tools; hard elapsed time survives a new connection', () => fixture(path => {
  let time=1000; const a=new LongTaskBudget(path,()=>time);
  assert.equal(a.reserve(scope,'one',1,1,price).softLimit,false);
  time+=LONG_TASK_POLICY.softMs;
  assert.equal(a.reserve(scope,'two',1,1,price).softLimit,true); a.close();
  time+=LONG_TASK_POLICY.softMs;
  const b=new LongTaskBudget(path,()=>time);
  assert.throws(()=>b.reserve(scope,'three',1,1,price),{code:'TASK_TIME_BUDGET'}); b.close();
}));
test('actual bill is never clipped; exceeding reservation blocks new dispatch', () => fixture(path => {
  const db=new LongTaskBudget(path); db.reserve(scope,'one',1,1,price);
  db.settle(scope,'one',{inputTokens:100,outputTokens:100});
  assert.equal(db.snapshot(scope).task,200);
  assert.throws(()=>db.reserve(scope,'two',1,1,price),{code:'MODEL_RESERVATION_EXCEEDED'}); db.close();
}));
test('concurrent independent processes cannot oversubscribe one root task',{timeout:15000},async()=>{
 const {spawn}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'dh-budget-processes-')),path=join(dir,'budget.sqlite');
 const initial=new LongTaskBudget(path);initial.close();
 const moduleUrl=new URL('../dist/native/budget.js',import.meta.url).href;
 const code=`import {LongTaskBudget} from ${JSON.stringify(moduleUrl)};const db=new LongTaskBudget(process.argv[1]);process.send('ready');process.on('message',()=>{try{db.reserve(${JSON.stringify(scope)},process.argv[2],1500000,1000000,${JSON.stringify(price)});process.send('reserved')}catch(e){process.send(e.code)}finally{db.close();process.disconnect()}});`;
 const children=[];
 try{
  const ready=Array.from({length:4},(_,i)=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',code,path,`call-${i}`],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
   child.once('error',reject);child.once('message',()=>resolve(child));
  }));
  await Promise.all(ready);
  const results=await Promise.all(children.map(child=>new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.send('reserve');})));
  assert.equal(results.filter(r=>r==='reserved').length,1);
  assert.equal(results.filter(r=>r==='TASK_COST_BUDGET').length,3);
  await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));
  const db=new LongTaskBudget(path);assert.equal(db.snapshot(scope).task,4000000);db.close();
 }finally{for(const child of children)if(child.exitCode===null)child.kill();rmSync(dir,{recursive:true,force:true});}
});
test('scope key is canonical across property order and ignores untrusted extra fields',()=>fixture(path=>{
 const db=new LongTaskBudget(path);db.reserve(scope,'canonical',1500000,1000000,price);
 const reordered={task:scope.task,user:scope.user,tenant:scope.tenant,attempt:'another'};
 assert.equal(db.snapshot(reordered).task,4000000);
 assert.throws(()=>db.reserve(reordered,'bypass',500000,1,price),{code:'TASK_COST_BUDGET'});db.close();
}));
