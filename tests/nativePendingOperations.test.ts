import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingOperation } from '../src/native-conversation/chat/pendingOperations.ts';
function store(): Storage {
  const values = new Map<string,string>();
  return { get length(){return values.size;}, clear(){values.clear();}, key(i){return [...values.keys()][i] ?? null;},
    getItem(k){return values.get(k) ?? null;}, setItem(k,v){values.set(k,v);}, removeItem(k){values.delete(k);} };
}
test('unknown writes retain opaque ID across callers; success clears it for a new identical message', async () => {
  const storage=store(), ids:string[]=[];
  const failed=async (id:string)=>{ids.push(id);throw Error('response lost');};
  await assert.rejects(pendingOperation('tenant','session','secret prompt',failed,storage));
  await assert.rejects(pendingOperation('tenant','session','secret prompt',failed,storage));
  assert.equal(ids[0],ids[1]);
  assert.ok(!storage.key(0)!.includes('secret'));
  await pendingOperation('tenant','session','secret prompt',async id=>ids.push(id),storage);
  assert.equal(ids[2],ids[0]);assert.equal(storage.length,0);
  await pendingOperation('tenant','session','secret prompt',async id=>ids.push(id),storage);
  assert.notEqual(ids[3],ids[0]);
});
test('storage failure prevents dispatch and conversations cannot share operation identity', async()=>{
  const storage=store();let calls=0;
  const blocked={...storage,setItem(){throw Error('denied');}};
  await assert.rejects(pendingOperation('t','s','send',async()=>{calls++;},blocked));
  assert.equal(calls,0);
  const ids:string[]=[];
  for(const s of ['one','two']) await assert.rejects(pendingOperation('t',s,'send',async id=>{ids.push(id);throw Error('lost');},storage));
  assert.notEqual(ids[0],ids[1]);
});
