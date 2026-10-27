import {test} from 'node:test';import assert from 'node:assert/strict';import {evaluate} from '../scripts/native-schedule-rules.mjs';
const base={id:'test',title:'Title',prompt:'Prompt',now:Date.parse('2026-10-27T00:00:00Z')};
test('official DH at/every/daily/weekly/cron and latest-only missed occurrences',()=>{
 for(const rule of [{kind:'at',at:'2026-10-28T00:00:00Z'},{kind:'every',everySeconds:60},{kind:'daily',daily:{time:'09:00:00',time_zone:'Asia/Shanghai'}},{kind:'weekly',weekly:{time:'09:00:00',time_zone:'Asia/Shanghai',weekdays:[1,3]}},{kind:'cron',cron:{expression:'0 9 * * 1-5',time_zone:'Asia/Shanghai'}}]){
  const record=evaluate({...base,rule});assert.ok(Date.parse(record.scheduledAt)>base.now);const due=evaluate({operation:'due',record,now:base.now+86400000*8});assert.ok(due.occurrenceAt);if(rule.kind!=='at')assert.ok(Date.parse(due.nextScheduledAt)>base.now+86400000*8);
 }
 assert.throws(()=>evaluate({...base,rule:{kind:'every',everySeconds:1}}));assert.throws(()=>evaluate({...base,rule:{kind:'cron',cron:{expression:'* * * * * *',time_zone:'UTC'}}}));
});
