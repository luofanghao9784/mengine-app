// Pure official DH calendar evaluation, no Harness process, model or network.
import {createAtScheduleRecord,createAfterScheduleRecord,createEveryScheduleRecord,createDailyScheduleRecord,createWeeklyScheduleRecord,createCronScheduleRecord,decodeScheduleRecord,isRecurringScheduleRecord,resolveRecurringOccurrence} from '@deepseek-ai/dsh-schedule';
export function evaluate(p){
 if(p.operation==='due'){const r=decodeScheduleRecord(p.record);return isRecurringScheduleRecord(r)?resolveRecurringOccurrence(r,p.now):{occurrenceAt:r.scheduledAt};}
 const r=p.rule,args=[p.id,p.prompt];
 switch(r.kind){
  case 'at':return createAtScheduleRecord(...args,r.at,p.now,p.title);
  case 'after':return createAfterScheduleRecord(...args,r.afterSeconds,p.now,p.title);
  case 'every':return createEveryScheduleRecord(...args,r.everySeconds,p.now,p.title);
  case 'daily':return createDailyScheduleRecord(...args,r.daily,p.now,p.title);
  case 'weekly':return createWeeklyScheduleRecord(...args,r.weekly,p.now,p.title);
  case 'cron':return createCronScheduleRecord(...args,r.cron,p.now,p.title);
  default:throw Error('INVALID_RULE');
 }
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){let raw='';for await(const b of process.stdin){raw+=b;if(raw.length>50000)throw Error('TOO_LARGE');}try{console.log(JSON.stringify(evaluate(JSON.parse(raw))));}catch{console.log(JSON.stringify({error:'NATIVE_SCHEDULE_RULE_INVALID'}));process.exitCode=2;}}
