package com.dreamcore.workspace.recommendation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.conversation.BriefingContentService;
import com.dreamcore.workspace.feedback.FeedbackService;
import com.dreamcore.workspace.methods.MethodSelection;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** A bounded, explicitly declared pool of current authorized results. No model inference or new audience. */
@Service
public class RecommendationService {
 public record Settings(int revision,boolean enabled) {}
 public record Target(String kind,UUID id,String versionKey) {}
 public record Candidate(UUID id,String kind,String versionKey,UUID workspaceId,String workspaceName,String title,String excerpt,
   boolean truncated,Instant createdAt,String executionClass,UUID conversationId,int taskRevision,int attempt,int preferenceRevision,
   UUID materialId,int materialVersion,String filename,boolean pinned,Instant openedAt) {
  // Read observations affect display, not the candidate ordering or pagination identity.
  private Candidate snapshotValue(){return new Candidate(id,kind,versionKey,workspaceId,workspaceName,title,excerpt,truncated,createdAt,executionClass,conversationId,taskRevision,attempt,preferenceRevision,materialId,materialVersion,filename,pinned,null);}
 }
 public record Presentation(String renderer,String style,UUID profileId,int profileRevision) {}
 public record Item(Candidate content,double score,MethodSelection.MethodRef method,Presentation presentation,String reason,String availability,FeedbackService.Target feedbackTarget,BriefingContentService.Document briefing) {}
 public record Page(UUID tenantId,Settings settings,List<Item> items,String snapshot,boolean hasMore,long eligibleTotal,int rankedCount,boolean poolLimited,int poolLimit,String businessOutcome) {}
 public record Opened(Target target,Instant openedAt,String evidence,String businessOutcome) {}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;
 private final ConversationService conversations;private final FeedbackService feedback;private final MethodSelection methods;
 private final JsonMapper json=new JsonMapper();private final BriefingContentService briefings;
 private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public RecommendationService(JdbcTemplate db,IdentityService identities,MaterialAccess access,ConversationService conversations,FeedbackService feedback,MethodSelection methods,com.dreamcore.workspace.departure.DepartureAccess departure,BriefingContentService briefings){this.briefings=briefings;this.departure=departure;this.db=db;this.identities=identities;this.access=access;this.conversations=conversations;this.feedback=feedback;this.methods=methods;}
 @Transactional public Settings settings(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);var values=db.query("SELECT revision,enabled FROM recommendation_settings WHERE tenant_id=? AND actor_id=?",(r,n)->new Settings(r.getInt(1),r.getBoolean(2)),tenant,actor);return values.isEmpty()?new Settings(0,true):values.getFirst();}
 @Transactional public Settings configure(UUID actor,UUID tenant,UUID key,int revision,boolean enabled){
  if(revision<0)throw IdentityException.invalid();String h=IdentityService.hash(tenant+"\n"+revision+"\n"+enabled);UUID prior=identities.priorRequest(actor,key,"RECOMMENDATION_SETTINGS",h);identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","recommendation:"+tenant+":"+actor);
  if(prior!=null)return json.readValue(db.queryForObject("SELECT receipt::text FROM recommendation_receipts WHERE actor_id=? AND request_id=?",String.class,actor,key),Settings.class);
  var old=settings(actor,tenant);if(old.revision()!=revision)throw new IdentityException(409,"RECOMMENDATION_CHANGED");
  var saved=new Settings(revision+1,enabled);db.update("INSERT INTO recommendation_settings(tenant_id,actor_id,enabled) VALUES (?,?,?) ON CONFLICT(tenant_id,actor_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=recommendation_settings.revision+1,updated_at=now()",tenant,actor,enabled);
  identities.remember(actor,key,"RECOMMENDATION_SETTINGS",h,tenant);db.update("INSERT INTO recommendation_receipts(actor_id,request_id,receipt) VALUES (?,?,?::jsonb)",actor,key,json.writeValueAsString(saved));return saved;
 }
 private record Pool(List<Candidate> items,long total) {}
 private Pool pool(UUID actor,UUID tenant,UUID workspace,boolean generatedOnly,String businessType,boolean publicationsOnly,boolean focused){
  if(workspace!=null)access.require(actor,tenant,workspace,false);
  var sql="""
   WITH spaces AS MATERIALIZED (
    SELECT w.* FROM workspaces w LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
    WHERE w.tenant_id=? AND (w.id=?::uuid OR ?::uuid IS NULL)
     AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
   ), candidates AS (
    SELECT t.id,'TASK' kind,'task:'||t.id||':'||t.revision||':'||t.attempt version_key,c.workspace_id,w.name workspace_name,coalesce(convert_from(b.content,'UTF8')::jsonb->>'title',CASE WHEN EXISTS(SELECT 1 FROM readable_source_tasks title_source WHERE title_source.id=(SELECT first_task.id FROM conversation_tasks first_task WHERE first_task.conversation_id=c.id ORDER BY first_task.created_at,first_task.id LIMIT 1)) THEN c.title ELSE '会话内容暂不可用' END) AS title,
     coalesce(convert_from(b.content,'UTF8')::jsonb->>'summary',left(t.reply,600)) excerpt,(b.id IS NULL AND length(t.reply)>600) truncated,t.finished_at created_at,t.execution_class,c.id conversation_id,
     t.revision task_revision,t.attempt,coalesce(p.revision,0) preference_revision,NULL::uuid material_id,0 material_version,'' filename,coalesce(p.pinned,false) pinned
    FROM conversations c JOIN spaces w ON w.id=c.workspace_id
    JOIN LATERAL(SELECT t.* FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.status='SUCCEEDED' AND t.mode='AGENT' AND t.reply IS NOT NULL
      AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) AND (NOT ? OR EXISTS (%s)) AND (?::text IS NULL OR EXISTS(SELECT 1 FROM (%s) classified WHERE convert_from(classified.content,'UTF8')::jsonb->>'businessType'=?)) ORDER BY t.finished_at DESC,t.id DESC LIMIT 1) t ON true
    LEFT JOIN LATERAL (%s) b ON true
    LEFT JOIN briefing_preferences p ON p.conversation_id=c.id AND p.owner_id=c.owner_id
    WHERE c.tenant_id=? AND c.owner_id=? AND c.purpose='BUSINESS' AND NOT coalesce(p.hidden,false) AND NOT ? AND (NOT ? OR coalesce(p.pinned,false))
     AND NOT EXISTS(SELECT 1 FROM ongoing_plan_runs r JOIN ongoing_plans p ON p.id=r.plan_id WHERE r.task_id=t.id AND NOT p.notify)
    UNION ALL
    SELECT v.id,'PUBLICATION','publication:'||v.id,v.workspace_id,w.name,v.filename,''::text,false,v.created_at,'PUBLISHED_COPY',NULL::uuid,
     0,0,coalesce(pref.revision,0),m.id,v.number,v.filename,coalesce(pref.pinned,false)
    FROM active_materials m JOIN spaces w ON w.id=m.workspace_id AND w.kind='SHARED'
    JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
    JOIN document_publications p ON p.material_version_id=v.id
    LEFT JOIN publication_preferences pref ON pref.tenant_id=v.tenant_id AND pref.material_id=m.id AND pref.actor_id=?
    WHERE (?::text IS NULL OR ?='RESULT') AND (NOT ? OR coalesce(pref.pinned,false))
   )
   SELECT c.*,o.opened_at,count(*) OVER() eligible_total FROM candidates c LEFT JOIN delivery_observations o
    ON o.tenant_id=? AND o.actor_id=? AND o.target_kind=c.kind AND o.target_id=c.id AND o.version_key=c.version_key
   ORDER BY c.created_at DESC,c.id LIMIT 1000
   """.formatted(BriefingContentService.ELIGIBLE,BriefingContentService.ELIGIBLE,BriefingContentService.ELIGIBLE);
  final long[] total={0};db.execute("SET LOCAL statement_timeout='3s'");
  var items=db.query(sql,(r,n)->{total[0]=r.getLong("eligible_total");return new Candidate(r.getObject("id",UUID.class),r.getString("kind"),r.getString("version_key"),r.getObject("workspace_id",UUID.class),r.getString("workspace_name"),r.getString("title"),r.getString("excerpt"),r.getBoolean("truncated"),r.getTimestamp("created_at").toInstant(),r.getString("execution_class"),r.getObject("conversation_id",UUID.class),r.getInt("task_revision"),r.getInt("attempt"),r.getInt("preference_revision"),r.getObject("material_id",UUID.class),r.getInt("material_version"),r.getString("filename"),r.getBoolean("pinned"),r.getTimestamp("opened_at")==null?null:r.getTimestamp("opened_at").toInstant());},actor,tenant,workspace,workspace,actor,generatedOnly,businessType,businessType,tenant,actor,publicationsOnly,focused,actor,businessType,businessType,focused,tenant,actor);
  return new Pool(items,total[0]);
 }
 private Presentation presentation(UUID actor,UUID tenant){
  var p=feedback.preferences(actor,tenant).items().stream().filter(v->v.scenario().equals("GENERAL") && v.status().equals("ACTIVE") && v.style()!=null).findFirst();
  // Layout only: preserve original text and constraints. No fabricated conclusions or automatic summarization.
  return p.map(v->new Presentation("source-preserving-v1",v.style(),v.profileId(),v.revision())).orElseGet(()->new Presentation("source-preserving-v1","DEFAULT",null,0));
 }
 private FeedbackService.Target feedbackTarget(UUID actor,UUID tenant,Candidate c,MethodSelection.MethodRef method,Presentation presentation,Settings settings){
  String fingerprint=IdentityService.hash(json.writeValueAsString(List.of(c.versionKey(),c.preferenceRevision(),method,presentation,settings)));
  if(c.kind().equals("PUBLICATION")){
   UUID publication=db.queryForObject("SELECT id FROM document_publications WHERE material_version_id=? AND tenant_id=?",UUID.class,c.id(),tenant);
   Integer id=db.queryForObject("INSERT INTO recommendation_presentations(tenant_id,actor_id,task_revision,attempt,fingerprint,method,presentation,settings_revision,publication_id,material_version_id) VALUES (?,?,0,0,?,?::jsonb,?::jsonb,?,?,?) ON CONFLICT(tenant_id,actor_id,material_version_id,fingerprint) WHERE material_version_id IS NOT NULL DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id",Integer.class,tenant,actor,fingerprint,json.writeValueAsString(method),json.writeValueAsString(presentation),settings.revision(),publication,c.id());
   return new FeedbackService.Target("PUBLICATION",null,0,0,"recommendation-v1",id,publication,c.id(),c.materialVersion());
  }
  Integer id=db.queryForObject("INSERT INTO recommendation_presentations(tenant_id,actor_id,task_id,task_revision,attempt,fingerprint,method,presentation,settings_revision) VALUES (?,?,?,?,?,?,?::jsonb,?::jsonb,?) ON CONFLICT(tenant_id,actor_id,task_id,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id",Integer.class,tenant,actor,c.id(),c.taskRevision(),c.attempt(),fingerprint,json.writeValueAsString(method),json.writeValueAsString(presentation),settings.revision());
  return new FeedbackService.Target("BRIEFING",c.id(),c.taskRevision(),c.attempt(),"recommendation-v1",id);
 }
 @Transactional public Page list(UUID actor,UUID tenant,UUID workspace,int offset,int limit,String expectedSnapshot){return list(actor,tenant,workspace,offset,limit,expectedSnapshot,false);}
 @Transactional public Page list(UUID actor,UUID tenant,UUID workspace,int offset,int limit,String expectedSnapshot,boolean generatedOnly){return list(actor,tenant,workspace,offset,limit,expectedSnapshot,generatedOnly,null,false,false);}
 @Transactional public Page list(UUID actor,UUID tenant,UUID workspace,int offset,int limit,String expectedSnapshot,boolean generatedOnly,String businessType,boolean publicationsOnly,boolean focused){
  if(businessType!=null&&!Set.of("INFO","DATA","INSIGHT","SUGGESTION","RESULT").contains(businessType))throw IdentityException.invalid();
  if(offset<0||offset>1000||limit<1||limit>30||expectedSnapshot!=null&&!expectedSnapshot.matches("[0-9a-f]{64}"))throw IdentityException.invalid();
  var settings=settings(actor,tenant);if(!settings.enabled()&&!focused)return new Page(tenant,settings,List.of(),IdentityService.hash("disabled:"+settings.revision()),false,0,0,false,1000,"NOT_ASSESSED");
  var pool=pool(actor,tenant,workspace,generatedOnly,businessType,publicationsOnly,focused);var lookup=new HashMap<UUID,Candidate>();var features=new ArrayList<MethodSelection.Candidate>();long day=LocalDate.now(ZoneOffset.UTC).toEpochDay();
  for(var c:pool.items()){lookup.put(c.id(),c);double age=Math.max(0,day-c.createdAt().atZone(ZoneOffset.UTC).toLocalDate().toEpochDay());features.add(new MethodSelection.Candidate(c.id(),c.workspaceId(),c.pinned()?1:c.kind().equals("TASK")?.6:.4,1/(1+age/7),c.pinned()?1:0,c.createdAt()));}
  var ranked=methods.rank(actor,tenant,features);var presentation=presentation(actor,tenant);
  String snapshot=IdentityService.hash(json.writeValueAsString(List.of(settings,generatedOnly,businessType==null?"ALL":businessType,publicationsOnly,focused,ranked.snapshotKey(),pool.items().stream().map(Candidate::snapshotValue).toList(),presentation)));
  if(offset>0 && (expectedSnapshot==null || !snapshot.equals(expectedSnapshot)))throw new IdentityException(409,"RECOMMENDATION_SNAPSHOT_CHANGED");
  // Preserve the effective method's value/date/tie-break ordering after a card is read.
  var ordered=ranked.items();
  var page=ordered.stream().skip(offset).limit(limit).map(r->{var c=lookup.get(r.candidate().id());String reason=c.pinned()?"你已明确关注这项内容":c.kind().equals("TASK")?"你本人完成的会话成果，按当前有效方法排序":"当前获权空间已明确发布的独立企业副本";return new Item(c,r.score(),r.method(),presentation,reason,"AVAILABLE_IN_APP",feedbackTarget(actor,tenant,c,r.method(),presentation,settings),c.kind().equals("TASK")?briefings.find(c.id(),c.attempt()):null);}).toList();
  return new Page(tenant,settings,page,snapshot,offset+page.size()<ordered.size(),pool.total(),ordered.size(),pool.total()>1000,1000,"NOT_ASSESSED");
 }
 public record PublicationPreference(int revision,boolean pinned){}
 @Transactional public PublicationPreference publicationPreference(UUID actor,UUID tenant,UUID material){
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("SELECT m.workspace_id FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=? AND m.tenant_id=? AND w.kind='SHARED' AND EXISTS(SELECT 1 FROM document_publications p WHERE p.material_id=m.id)",UUID.class,material,tenant);if(rows.isEmpty())throw new IdentityException(404,"DELIVERY_NOT_FOUND");access.require(actor,tenant,rows.getFirst(),false);
  var values=db.query("SELECT revision,pinned FROM publication_preferences WHERE tenant_id=? AND actor_id=? AND material_id=?",(r,n)->new PublicationPreference(r.getInt(1),r.getBoolean(2)),tenant,actor,material);return values.isEmpty()?new PublicationPreference(0,false):values.getFirst();
 }
 @Transactional public PublicationPreference followPublication(UUID actor,UUID tenant,UUID material,UUID key,int revision,boolean pinned){
  var hash=IdentityService.hash(tenant+"\n"+material+"\n"+revision+"\n"+pinned);UUID prior=identities.priorRequest(actor,key,"PUBLICATION_FOLLOW",hash);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","publication-follow:"+tenant+":"+actor+":"+material);
  var current=publicationPreference(actor,tenant,material);if(prior!=null)return current;if(current.revision()!=revision)throw new IdentityException(409,"BRIEFING_REVISION_CONFLICT");
  db.update("INSERT INTO publication_preferences(tenant_id,actor_id,material_id,pinned) VALUES (?,?,?,?) ON CONFLICT(tenant_id,actor_id,material_id) DO UPDATE SET pinned=excluded.pinned,revision=publication_preferences.revision+1,updated_at=now()",tenant,actor,material,pinned);identities.remember(actor,key,"PUBLICATION_FOLLOW",hash,material);return publicationPreference(actor,tenant,material);
 }
 @Transactional public Opened opened(UUID actor,UUID tenant,Target target){
  if(target==null||target.kind()==null||target.id()==null||target.versionKey()==null||target.versionKey().length()>120||!Set.of("TASK","PUBLICATION").contains(target.kind()))throw IdentityException.invalid();identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  if(target.kind().equals("TASK")){
   var rows=db.queryForList("SELECT conversation_id,revision,attempt FROM conversation_tasks WHERE tenant_id=? AND id=?",tenant,target.id());if(rows.isEmpty())throw new IdentityException(404,"DELIVERY_NOT_FOUND");var r=rows.getFirst();
   conversations.historical(actor,tenant,(UUID)r.get("conversation_id"),target.id());if(!target.versionKey().equals("task:"+target.id()+":"+r.get("revision")+":"+r.get("attempt")))throw new IdentityException(409,"DELIVERY_VERSION_CHANGED");
  }else{
   var rows=db.queryForList("SELECT v.workspace_id FROM material_versions v JOIN document_publications p ON p.material_version_id=v.id WHERE v.tenant_id=? AND v.id=?",tenant,target.id());if(rows.isEmpty())throw new IdentityException(404,"DELIVERY_NOT_FOUND");
   UUID w=(UUID)rows.getFirst().get("workspace_id");access.require(actor,tenant,w,false);access.requireVersionActive(tenant,w,target.id());if(!target.versionKey().equals("publication:"+target.id()))throw new IdentityException(409,"DELIVERY_VERSION_CHANGED");
  }
  db.update("INSERT INTO delivery_observations(tenant_id,actor_id,target_kind,target_id,version_key) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",tenant,actor,target.kind(),target.id(),target.versionKey());
  return new Opened(target,db.queryForObject("SELECT opened_at FROM delivery_observations WHERE tenant_id=? AND actor_id=? AND target_kind=? AND target_id=? AND version_key=?",(r,n)->r.getTimestamp(1).toInstant(),tenant,actor,target.kind(),target.id(),target.versionKey()),"USER_OPEN_ACTION","NOT_ASSESSED");
 }
}
