/** Regression probe for #190's repaired date and one-shot projection boundaries. */
import assert from 'node:assert/strict';
import {emptyForm,fromConfig,toConfig,formProblems} from '../../src/native-conversation/schedules.ts';
const f={...emptyForm(new Date('2026-10-27T00:00:00Z'),'Asia/Shanghai'),title:'Synthetic',prompt:'Check'};
const base=toConfig(f);
assert.equal(toConfig({...f,expires:''}).expiresAt,'');
assert.ok(formProblems({...f,expires:''}).length);
for(const rule of [{kind:'after' as const,afterSeconds:3600},{kind:'at' as const,at:'2026-10-28T09:00:00Z'}]){
 const form=fromConfig({...base,rule},f);
 assert.deepEqual(toConfig({...form,title:'renamed'}).rule,rule);
 if(rule.kind==='at')assert.equal(form.time,'17:00');
}
console.log('PASS: empty expiry is recoverable; after stays one-shot; UTC at preserves its instant.');
