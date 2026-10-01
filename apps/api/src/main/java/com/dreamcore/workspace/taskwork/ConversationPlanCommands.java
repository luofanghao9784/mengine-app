package com.dreamcore.workspace.taskwork;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.plans.*;
import java.time.*;
import java.util.*;
import java.util.regex.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Current-user delegation only. Existing background plans cannot broaden their own authority. */
@Service
public class ConversationPlanCommands {
 public record Request(String action,UUID planId,Integer expectedRevision,UUID workspaceId,String goal,String query,String dailyTime,Boolean materialEvents,String evidence){}
 public record Receipt(String action,int acceptedRevision,PlanService.Plan plan,boolean changedSinceAcceptance){}
 private final JdbcTemplate db;private final AgentTaskService agents;private final ConversationService conversations;private final PlanService plans;private final PlanClock clock;private final IdentityService identities;private final JsonMapper json=new JsonMapper();
 public ConversationPlanCommands(JdbcTemplate db,AgentTaskService agents,ConversationService conversations,PlanService plans,PlanClock clock,IdentityService identities){this.db=db;this.agents=agents;this.conversations=conversations;this.plans=plans;this.clock=clock;this.identities=identities;}
 private Map<String,Object> declined(String reason){return Map.of("saved",false,"reason",reason);}
 private UUID key(UUID task,String purpose){return UUID.nameUUIDFromBytes(("conversation-plan:"+task+":"+purpose).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 @Transactional public Object invoke(UUID task,UUID attempt,Request r){
  agents.check(task,attempt);
  var t=db.queryForMap("SELECT t.*,c.purpose,c.owner_id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=?",task);
  UUID actor=(UUID)t.get("owner_id"),tenant=(UUID)t.get("tenant_id");
  if(!"BUSINESS".equals(t.get("purpose"))||db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE task_id=?",Integer.class,task)>0)throw new IdentityException(403,"TASK_WORK_DENIED");
  if(r==null||r.action()==null)throw IdentityException.invalid();
  if(db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"manage_plan\"]'::jsonb",Integer.class,task,attempt)!=1||db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='manage_plan' AND status='STARTED'",Integer.class,task,task)==0)throw new IdentityException(403,"TASK_WORK_DENIED");
  if(r.action().equals("read"))return Map.of("plans",plans.list(actor,tenant,0,30),"workspaces",identities.context(actor,tenant).workspaces(),"now",clock.now().toString(),"timeZone","Asia/Shanghai","supportedTriggers",List.of("DAILY","MATERIAL_CHANGE"),"resourcePolicy",Map.of("maxRunsPerDay",1,"minIntervalSeconds",86400,"maxDurationDays",366),"recipient","CURRENT_USER_IN_APP");
  if(!Set.of("create","update","pause","resume","stop","mute","unmute").contains(r.action()))throw IdentityException.invalid();
  String evidence=r.evidence(),prompt=(String)t.get("prompt"),supplement=(String)t.get("supplemental_input");
  if(evidence==null||evidence.length()>2000||!(evidence.equals(prompt)||evidence.equals(supplement))||evidence.matches("(?s).*(不要|别|不需要|不想|假设|例如|举例|如果|能否|是否|[“”\"「」]).*"))return declined("EXPLICIT_CURRENT_DELEGATION_REQUIRED");
  String hash=IdentityService.hash(json.writeValueAsString(r));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","conversation-plan:"+task);
  var prior=db.queryForList("SELECT * FROM conversation_plan_commands WHERE task_id=?",task);
  if(!prior.isEmpty()){var p=prior.getFirst();if(!hash.equals(p.get("request_hash")))return Map.of("saved",true,"alreadyApplied",true,"receipt",receipt(actor,tenant,p));return Map.of("saved",true,"receipt",receipt(actor,tenant,p));}
  if(db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"manage_plan\"]'::jsonb",Integer.class,task,attempt)!=1)throw new IdentityException(403,"TASK_WORK_DENIED");
  PlanService.Plan previous=null;
  if(!r.action().equals("create")){
   if(r.planId()==null||r.expectedRevision()==null)return declined("PLAN_AND_REVISION_REQUIRED");previous=plans.get(actor,tenant,r.planId());
   if(previous.revision()!=r.expectedRevision())throw new IdentityException(409,"PLAN_REVISION_CONFLICT");
   var available=plans.list(actor,tenant,0,30);if(available.items().size()>1&&!evidence.contains(previous.configuration().goal()))return declined("PLAN_TARGET_AMBIGUOUS");
  }
  PlanService.Plan saved;
  if(r.action().equals("create")||r.action().equals("update")){
   if(r.workspaceId()==null||r.goal()==null||r.goal().isBlank()||r.query()==null||r.query().isBlank())return declined("WORK_AND_SOURCE_REQUIRED");
   var context=identities.context(actor,tenant);var spaces=context.workspaces().stream().filter(s->s.id().equals(r.workspaceId())).toList();if(spaces.isEmpty())throw new IdentityException(404,"MATERIAL_LOCATION_UNAVAILABLE");
   boolean named=evidence.contains(spaces.getFirst().name());
   boolean personal=evidence.contains("个人资料")&&"PERSONAL".equals(spaces.getFirst().kind());
   boolean current=evidence.matches("(?s).*(当前空间|本空间).*")&&r.workspaceId().equals(t.get("workspace_id"));
   if((previous==null||!previous.configuration().workspaceId().equals(r.workspaceId()))&&!named&&!personal&&!current)return declined("EXPLICIT_SOURCE_SCOPE_REQUIRED");
   if(evidence.matches("(?s).*(发给|发送给|推送给|邮件|短信|微信|外部).*"))return declined("ONLY_CURRENT_USER_IN_APP_SUPPORTED");
   boolean material=Boolean.TRUE.equals(r.materialEvents());
   if(material&&(previous==null||!previous.configuration().materialEvents())&&!evidence.matches("(?s).*资料.*(变化|更新|新版本).*"))return declined("EXPLICIT_TRIGGER_REQUIRED");
   if(r.dailyTime()!=null&&(previous==null||!Objects.equals(previous.configuration().dailyTime(),r.dailyTime()))&&((previous==null&&!evidence.matches("(?s).*(每天|每日).*" ))||!timeMentioned(evidence,r.dailyTime())))return declined("EXPLICIT_DAILY_TIME_REQUIRED");
   if(!material&&r.dailyTime()==null)return declined("SUPPORTED_TRIGGER_REQUIRED");
   Instant expires=expiry(evidence);if(expires==null&&previous!=null)expires=previous.configuration().expiresAt();if(expires==null)return declined("END_DATE_REQUIRED");
   int days=(int)Math.max(1,Math.min(366,Duration.between(clock.now(),expires).toDays()+1));
   var configuration=new PlanService.Configuration(r.workspaceId(),r.goal(),"本人会话明确委托；仅本人在系统内查看；每日最多一次。",r.query(),"ANALYZE",material,r.dailyTime(),"Asia/Shanghai",previous==null?86400:previous.configuration().minIntervalSeconds(),previous==null?1:previous.configuration().maxRunsPerDay(),previous==null?days:(expires.equals(previous.configuration().expiresAt())?previous.configuration().maxTotalRuns():Math.max(previous.configuration().maxTotalRuns(),previous.runs()+days)),expires,previous==null||previous.configuration().notificationsEnabled());
   if(r.action().equals("create")){saved=plans.create(actor,tenant,key(task,"create"),configuration);saved=plans.action(actor,tenant,saved.id(),key(task,"enable"),saved.revision(),"ENABLE",true);}
   else {if(r.planId()==null||r.expectedRevision()==null)return declined("PLAN_AND_REVISION_REQUIRED");var existing=plans.get(actor,tenant,r.planId());if(existing.revision()!=r.expectedRevision())throw new IdentityException(409,"PLAN_REVISION_CONFLICT");if(!evidence.matches("(?s).*(修改|调整|改成|改为|改到).*"))return declined("EXPLICIT_UPDATE_REQUIRED");if(existing.status().equals("ACTIVE"))existing=plans.action(actor,tenant,existing.id(),key(task,"pause-edit"),existing.revision(),"PAUSE",false);saved=plans.update(actor,tenant,existing.id(),key(task,"update"),existing.revision(),configuration,"PAUSED".equals(previous.status()));if("ACTIVE".equals(previous.status()))saved=plans.action(actor,tenant,saved.id(),key(task,"enable"),saved.revision(),"ENABLE",true);}
  }else{
   if(r.planId()==null||r.expectedRevision()==null)return declined("PLAN_AND_REVISION_REQUIRED");
   String term=switch(r.action()){case "pause"->"暂停";case "resume"->"恢复";case "stop"->"停止";case "mute"->"关闭提醒";default->"开启提醒";};if(!evidence.contains(term))return declined("EXPLICIT_ACTION_REQUIRED");
   saved=plans.action(actor,tenant,r.planId(),key(task,r.action()),r.expectedRevision(),r.action().toUpperCase(Locale.ROOT),true);
  }
  db.update("INSERT INTO conversation_plan_commands(task_id,tenant_id,owner_id,plan_id,action,request_hash,accepted_revision,evidence_sha) VALUES (?,?,?,?,?,?,?,?)",task,tenant,actor,saved.id(),r.action(),hash,saved.revision(),IdentityService.hash(evidence));
  return Map.of("saved",true,"receipt",new Receipt(r.action(),saved.revision(),saved,false));
 }
 private boolean timeMentioned(String text,String time){
  if(time==null||!time.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))return false;int hour=Integer.parseInt(time.substring(0,2)),minute=Integer.parseInt(time.substring(3));
  Matcher numeric=Pattern.compile("(?<![0-9])([0-9]{1,2}):([0-9]{2})(?![0-9])").matcher(text);
  while(numeric.find())if(Integer.parseInt(numeric.group(1))==hour&&Integer.parseInt(numeric.group(2))==minute)return true;
  String[] cn={"零","一","二","三","四","五","六","七","八","九","十","十一","十二"};
  Matcher point=Pattern.compile("(凌晨|早上|上午|中午|下午|晚上|晚间)?([0-9]{1,2}|十二|十一|十|[零一二三四五六七八九])点(半|[0-9]{1,2}分)?").matcher(text);
  while(point.find()){
   String raw=point.group(2),period=point.group(1);int h;try{h=Integer.parseInt(raw);}catch(NumberFormatException ignored){h=Arrays.asList(cn).indexOf(raw);}
   if(h<0||h>23)continue;
   if(period!=null&&Set.of("下午","晚上","晚间").contains(period)&&h<12)h+=12;
   if("凌晨".equals(period)&&h==12)h=0;
   if("中午".equals(period)&&h<11)h+=12;
   String m=point.group(3);int min=m==null?0:m.equals("半")?30:Integer.parseInt(m.substring(0,m.length()-1));
   if(h==hour&&min==minute)return true;
  }
  return false;
 }
 private Instant expiry(String evidence){
  ZoneId zone=ZoneId.of("Asia/Shanghai");LocalDate today=clock.now().atZone(zone).toLocalDate();
  if(evidence.contains("本月"))return today.withDayOfMonth(1).plusMonths(1).atStartOfDay(zone).toInstant();
  Matcher days=Pattern.compile("(?:未来|接下来|持续|为期)([0-9]{1,3})天").matcher(evidence);if(days.find()){int n=Integer.parseInt(days.group(1));if(n>0&&n<=366)return clock.now().plus(Duration.ofDays(n));}
  Matcher until=Pattern.compile("(?:截至|直到|到)([0-9]{4}-[0-9]{2}-[0-9]{2})").matcher(evidence);if(until.find())try{return LocalDate.parse(until.group(1)).plusDays(1).atStartOfDay(zone).toInstant();}catch(Exception ignored){}
  return null;
 }
 private Receipt receipt(UUID actor,UUID tenant,Map<String,Object> row){var p=plans.get(actor,tenant,(UUID)row.get("plan_id"));int revision=(Integer)row.get("accepted_revision");return new Receipt((String)row.get("action"),revision,p,p.revision()!=revision);}
 @Transactional public List<Receipt> receipts(UUID actor,UUID tenant,UUID task){var rows=db.queryForList("SELECT c.id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.tenant_id=? AND c.owner_id=?",UUID.class,task,tenant,actor);if(rows.isEmpty())throw new IdentityException(404,"TASK_NOT_FOUND");if(conversations.taskDetail(actor,tenant,rows.getFirst(),task).tasks().getFirst().sourcesUnavailable())throw new IdentityException(404,"TASK_SOURCE_UNAVAILABLE");return db.queryForList("SELECT * FROM conversation_plan_commands WHERE task_id=?",task).stream().map(r->receipt(actor,tenant,r)).toList();}
}
