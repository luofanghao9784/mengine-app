package com.dreamcore.workspace.audience;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Job context changes relevance and language, never source authority or private ownership. */
@Service
public class WorkAudienceService {
 public record Focus(String key,String label,List<String> keywords,String starter) {}
 public static final List<Focus> FOCUSES=List.of(
  new Focus("OPERATIONS","经营情况",List.of("经营","订单","销售","营业","门店","指标"),"最近经营情况怎么样？先说最值得关注的变化，再说明依据和下一步。"),
  new Focus("SERVICE","服务与当天工作",List.of("服务","预约","美容","洗护","护理","交接","操作","宠物"),"结合我负责的服务工作，今天需要准备什么、留意什么？没有当天数据的地方请说清楚。"),
  new Focus("CUSTOMER","客户与回访",List.of("客户","会员","回访","客诉","积分","宠物档案"),"我负责的客户工作有哪些值得跟进的事情？请说明原因，并给出可以直接使用的沟通建议。"),
  new Focus("SALES","销售与活动",List.of("销售","订单","商品","活动","促销","营销"),"最近销售和活动有哪些变化？请按我能处理的工作，给出有依据的建议。"),
  new Focus("INVENTORY","商品与库存",List.of("库存","供应","采购","商品","盘点","入库","出库"),"商品和库存有哪些需要我核对的地方？请说清楚核对什么、为什么要核对。"),
  new Focus("FINANCE","收支与对账",List.of("收款","退款","财务","支付","收入","成本","对账","订单"),"收支和对账有哪些需要注意的地方？请保留统计时间和金额依据，不确定的地方单独说明。"),
  new Focus("TEAM","人员与协作",List.of("员工","岗位","排班","职责","交接","协作","培训"),"人员安排和工作交接有哪些待办？请区分我能直接处理的事情和需要找负责人确认的事情。"),
  new Focus("COMPLIANCE","风险与规范",List.of("风险","安全","制度","规范","权限","隐私","检查","应急"),"与我职责有关的安全或规范要求有哪些？请用日常工作的话说明怎么做。")
 );
 public record Profile(UUID accountId,String name,String systemRole,String department,String jobTitle,String responsibilities,List<String> focus,int revision) {}
 public record Page(boolean canMaintain,List<Profile> members,List<Focus> choices) {}
 public record Change(UUID requestId,int expectedRevision,String department,String jobTitle,String responsibilities,List<String> focus) {}
 public record Context(String version,String key,String role,String roleLabel,String department,String jobTitle,String responsibilities,List<String> focus,List<String> focusLabels,List<String> starters,boolean configured,boolean authority) {}
 private final JdbcTemplate db;private final IdentityService identities;private final GovernanceAccess governance;private final IdentityAudit audit;private final DepartureAccess departure;
 private final JsonMapper json=new JsonMapper();
 public WorkAudienceService(JdbcTemplate db,IdentityService identities,GovernanceAccess governance,IdentityAudit audit,DepartureAccess departure){this.db=db;this.identities=identities;this.governance=governance;this.audit=audit;this.departure=departure;}
 private void read(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);if(identities.supportAccess(actor,tenant))throw new IdentityException(403,"PRIVATE_PREFERENCE_DENIED");}
 private void lock(UUID tenant,UUID actor,boolean write){db.queryForList("SELECT "+(write?"pg_advisory_xact_lock":"pg_advisory_xact_lock_shared")+"(hashtextextended(?,0))","work-audience:"+tenant+":"+actor);db.queryForList("SELECT account_id FROM tenant_memberships WHERE tenant_id=? AND account_id=? FOR SHARE",tenant,actor);db.queryForList("SELECT tenant_id FROM tenant_governance WHERE tenant_id=? FOR SHARE",tenant);}
 private Profile profile(UUID tenant,UUID actor){
  var rows=db.queryForList("SELECT m.account_id,a.display_name,m.role,g.owner_id,p.department,p.job_title,p.responsibilities,p.focus,p.revision FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id LEFT JOIN tenant_governance g ON g.tenant_id=m.tenant_id LEFT JOIN work_role_profiles p ON p.tenant_id=m.tenant_id AND p.account_id=m.account_id WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE'",tenant,actor);
  if(rows.isEmpty())throw new IdentityException(404,"MEMBER_NOT_FOUND");var r=rows.getFirst();String role=actor.equals(r.get("owner_id"))?"OWNER":r.get("role").toString().equals("TENANT_ADMIN")?"ADMIN":"MEMBER";
  return new Profile(actor,Objects.toString(r.get("display_name"),""),role,Objects.toString(r.get("department"),""),Objects.toString(r.get("job_title"),""),Objects.toString(r.get("responsibilities"),""),r.get("focus")==null?List.of():List.of(json.readValue(r.get("focus").toString(),String[].class)),r.get("revision")==null?0:(Integer)r.get("revision"));
 }
 @Transactional public Page list(UUID actor,UUID tenant){read(actor,tenant);boolean manage=governance.allows(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);var ids=manage?db.queryForList("SELECT account_id FROM tenant_memberships WHERE tenant_id=? AND status='ACTIVE' ORDER BY account_id LIMIT 501",UUID.class,tenant):List.of(actor);if(ids.size()>500)throw new IdentityException(422,"WORK_ROLE_MEMBER_LIMIT");return new Page(manage,ids.stream().map(id->profile(tenant,id)).toList(),FOCUSES);}
 private String text(String v,int max){if(v==null||v.length()>max||v.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return v.strip();}
 @Transactional public Profile save(UUID actor,UUID tenant,UUID target,Change c){
  read(actor,tenant);departure.requireActiveBusiness(actor,tenant);governance.require(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);
  if(c==null||c.requestId()==null||c.expectedRevision()<0||c.focus()==null||c.focus().size()>8||new HashSet<>(c.focus()).size()!=c.focus().size()||c.focus().stream().anyMatch(k->FOCUSES.stream().noneMatch(f->f.key().equals(k))))throw IdentityException.invalid();
  String department=text(c.department(),100),title=text(c.jobTitle(),100),duties=text(c.responsibilities(),1200);var focus=c.focus().stream().sorted().toList();
  String hash=IdentityService.hash(json.writeValueAsString(Arrays.asList(tenant,target,c.expectedRevision(),department,title,duties,focus)));
  lock(tenant,target,true);var before=profile(tenant,target);if(identities.priorRequest(actor,c.requestId(),"WORK_ROLE_SAVE",hash)!=null)return before;
  if(before.revision()!=c.expectedRevision())throw new IdentityException(409,"WORK_ROLE_CHANGED");
  if(before.department().equals(department)&&before.jobTitle().equals(title)&&before.responsibilities().equals(duties)&&before.focus().stream().sorted().toList().equals(focus)){identities.remember(actor,c.requestId(),"WORK_ROLE_SAVE",hash,target);return before;}

  db.update("INSERT INTO work_role_profiles(tenant_id,account_id,department,job_title,responsibilities,focus,revision,changed_by) VALUES (?,?,?,?,?,?::jsonb,1,?) ON CONFLICT(tenant_id,account_id) DO UPDATE SET department=excluded.department,job_title=excluded.job_title,responsibilities=excluded.responsibilities,focus=excluded.focus,revision=work_role_profiles.revision+1,changed_by=excluded.changed_by,changed_at=clock_timestamp()",tenant,target,department,title,duties,json.writeValueAsString(focus),actor);
  identities.remember(actor,c.requestId(),"WORK_ROLE_SAVE",hash,target);audit.record(actor,tenant,"WORK_ROLE_CHANGED",target,"SUCCESS");return profile(tenant,target);
 }
 @Transactional public Context current(UUID actor,UUID tenant){
  read(actor,tenant);lock(tenant,actor,false);var p=profile(tenant,actor);List<String> defaults=switch(p.systemRole()){case "OWNER"->List.of("OPERATIONS","FINANCE","CUSTOMER","TEAM","COMPLIANCE");case "ADMIN"->List.of("TEAM","COMPLIANCE");default->List.of();};
  String duties=p.jobTitle()+" "+p.responsibilities();var inferred=FOCUSES.stream().filter(f->f.keywords().stream().anyMatch(duties::contains)).map(Focus::key).toList();
  List<String> focus=!p.focus().isEmpty()?p.focus():!inferred.isEmpty()?inferred:defaults;
  var selected=FOCUSES.stream().filter(f->focus.contains(f.key())).toList();String label=switch(p.systemRole()){case "OWNER"->"企业负责人";case "ADMIN"->"企业管理员";default->"工作人员";};
  var starters=selected.isEmpty()?List.of("根据我能查看的资料，梳理当前工作需要留意的事项。请先确认我负责的工作，不要替我推定岗位。","帮我把选中的资料整理成容易照着做的步骤；不确定的地方请指出来。"):selected.stream().limit(3).map(Focus::starter).toList();
  return new Context("1.0",key(actor,tenant),p.systemRole(),label,p.department(),p.jobTitle(),p.responsibilities(),focus,selected.stream().map(Focus::label).toList(),starters,!p.jobTitle().isBlank()||!p.responsibilities().isBlank()||!p.focus().isEmpty(),false);
 }
 public String key(UUID actor,UUID tenant){return db.queryForObject("SELECT work_audience_key(?,?)",String.class,tenant,actor);}
 /** Ranking applies only AFTER existing source ACL checks. Titles are relevance hints, never authorization. */
 public int sourceScore(Context c,String title){String value=title.toLowerCase(Locale.ROOT);return FOCUSES.stream().filter(f->c.focus().contains(f.key())).mapToInt(f->(int)f.keywords().stream().filter(value::contains).count()).sum();}
 @Transactional public Context task(UUID task){
  var saved=db.queryForList("SELECT s.context::text FROM task_audience_snapshots s JOIN conversation_tasks t ON t.id=s.task_id AND t.attempt=s.attempt_number WHERE t.id=?",String.class,task);
  if(!saved.isEmpty()){requireCurrent(task);return json.readValue(saved.getFirst(),Context.class);}
  var t=db.queryForMap("SELECT tenant_id,requested_by,attempt FROM conversation_tasks WHERE id=?",task);UUID tenant=(UUID)t.get("tenant_id"),actor=(UUID)t.get("requested_by");var now=current(actor,tenant);
  db.update("INSERT INTO task_audience_snapshots(task_id,attempt_number,audience_key,context) VALUES (?,?,?,?::jsonb) ON CONFLICT DO NOTHING",task,t.get("attempt"),now.key(),json.writeValueAsString(now));
  requireCurrent(task);return json.readValue(db.queryForObject("SELECT context::text FROM task_audience_snapshots WHERE task_id=? AND attempt_number=?",String.class,task,t.get("attempt")),Context.class);
 }
 @Transactional public void requireCurrent(UUID task){
  var t=db.queryForMap("SELECT tenant_id,requested_by FROM conversation_tasks WHERE id=?",task);lock((UUID)t.get("tenant_id"),(UUID)t.get("requested_by"),false);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT task_audience_current(?)",Boolean.class,task)))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");
 }
}
