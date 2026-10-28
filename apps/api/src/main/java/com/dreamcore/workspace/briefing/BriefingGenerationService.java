package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.plans.PlanClock;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Durable system-owned triggers; delegates execution to the same metered product runtime as conversations. */
@Service
public class BriefingGenerationService {
    public record Source(UUID materialId,UUID versionId,String filename,String parseStatus,Instant changedAt,String kind,UUID workspaceId) {
        Source(UUID id,UUID version,String name,String status,Instant changed,UUID sourceSpace){this(id,version,name,status,changed,"MATERIAL",sourceSpace);}
        boolean dataset(){return "DATASET".equals(kind);}
        Map<String,Object> selection(){return dataset()?Map.of("kind","DATASET","datasetId",materialId,"snapshotId",versionId):Map.of("materialId",materialId,"versionId",versionId);}
    }
    public record Batch(UUID id,UUID workspaceId,String trigger,String businessType,String status,String reason,UUID taskId,List<UUID> cardIds,Instant createdAt,Instant finishedAt) {}
    public record Policy(UUID id,UUID workspaceId,String workspaceName,boolean enabled,int revision,String reason) {}
    public record Quota(int limit,int used,int reserved,int remaining) {}
    public record Capability(boolean available,String reason) {}
    public record State(List<Policy> policies,List<Batch> batches,Quota quota,Map<String,Capability> capabilities,Quota automaticQuota) {}
    @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.audience.WorkAudienceService workAudience;
    @org.springframework.beans.factory.annotation.Autowired private IdentityAudit dailyAudit;
    @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.news.NewsSourceCatalog newsCatalog;
    @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.news.NewsSearchPolicy newsSearch;
    @Value("${dreamcore.briefing.daily-enabled:false}") private boolean dailyEnabled=false;
    private String newsSource(UUID tenant){if(newsSearch!=null&&newsSearch.enabled())return com.dreamcore.workspace.news.NewsSearchPolicy.QUERY;return newsCatalog==null?newsSource:newsCatalog.selected(tenant).map(com.dreamcore.workspace.news.NewsSourceCatalog.Source::url).orElse("");}
    private Capability newsCapability(UUID tenant){if(newsSearch!=null&&!newsSearch.enabled())return new Capability(false,"PUBLIC_SEARCH_NOT_CONFIGURED");String source=newsSource(tenant);return new Capability(!source.isBlank()&&agents.publicWebEnabled(),source.isBlank()?"NEWS_SOURCE_UNAVAILABLE":!agents.publicWebEnabled()?"PUBLIC_WEB_UNAVAILABLE":null);}
    private void requireNews(UUID tenant,String type){if("INFO".equals(type)&&!newsCapability(tenant).available())throw new IdentityException(409,"BRIEFING_INFO_UNAVAILABLE");}
    private static final Set<String> TYPES=Set.of("INFO","DATA","INSIGHT","SUGGESTION","RESULT");
    private static final Set<String> OPEN=Set.of("QUEUED","RUNNING","WAITING_DATA","WAITING_RESOURCE","WAITING_CAPABILITY");
    /** Person-side data waits that should fail a manual request instead of reserving forever. */
    private static final Set<String> MANUAL_TERMINAL_DATA=Set.of(
        "NO_MATERIALS","MATERIALS_NOT_READY","WORK_GOAL_REQUIRED","RESULT_NOT_READY","SOURCE_COVERAGE_TOO_OLD",
        "SOURCE_GOVERNANCE_REQUIRED","SOURCE_FIELDS_UNCONFIRMED","SOURCE_DEFINITION_REQUIRED","SOURCE_CONSTRAINTS_REQUIRED",
        "SOURCE_RECEIPT_REQUIRED","SOURCE_VALIDATION_FAILED","SOURCE_RELATION_UNVERIFIED","SOURCE_ANALYSIS_PLAN_INVALID",
        "SOURCE_MODEL_REVIEW_REQUIRED","SOURCE_DELIVERY_WAITING");
    private final com.dreamcore.workspace.collection.DatasetContentFingerprint fingerprints;
    private final JdbcTemplate db;private final ConversationService tasks;private final BriefingContentService contents;
    @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.governance.GovernanceModelService governance;
    private final IdentityService identities;private final MaterialAccess access;private final DepartureAccess departure;
    private final AgentSettings agents;private final PlanClock clock;private final JsonMapper json=new JsonMapper();
    @Value("${dreamcore.briefing.once-tenant:}") private String onceTenant="";
    @Value("${dreamcore.briefing.once-owner:}") private String onceOwner="";
    private boolean automaticAllowed(UUID tenant,UUID actor){return automaticEnabled||(tenant.toString().equals(onceTenant)&&actor.toString().equals(onceOwner));}
    private final boolean tasksEnabled;private final String newsSource;private final int mergeSeconds,dailyLimit;
    @Value("${dreamcore.briefing.automatic-enabled:true}") private boolean automaticEnabled=true;
    public BriefingGenerationService(JdbcTemplate db,ConversationService tasks,BriefingContentService contents,com.dreamcore.workspace.collection.DatasetContentFingerprint fingerprints,IdentityService identities,MaterialAccess access,DepartureAccess departure,AgentSettings agents,PlanClock clock,
        @Value("${dreamcore.tasks.enabled:false}") boolean tasksEnabled,@Value("${dreamcore.briefing.news-source:}") String newsSource,
        @Value("${dreamcore.briefing.merge-seconds:60}") int mergeSeconds,@Value("${dreamcore.briefing.max-runs-per-day:6}") int dailyLimit){
        this.fingerprints=fingerprints;this.db=db;this.tasks=tasks;this.contents=contents;this.identities=identities;this.access=access;this.departure=departure;this.agents=agents;this.clock=clock;this.tasksEnabled=tasksEnabled;this.newsSource=validateNewsSource(newsSource);this.mergeSeconds=Math.max(0,mergeSeconds);this.dailyLimit=Math.max(1,Math.min(24,dailyLimit));
    }
    private static String validateNewsSource(String value){
        if(value==null||value.isBlank())return "";
        try{var u=java.net.URI.create(value.strip());if(!"https".equals(u.getScheme())||u.getHost()==null||u.getUserInfo()!=null||u.getFragment()!=null||value.length()>2048)throw new IllegalArgumentException();return u.toString();}
        catch(Exception e){throw new IllegalArgumentException("briefing.news-source must be a public HTTPS source URL");}
    }
    private boolean completedPublication(UUID version){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM document_publications p JOIN private_documents d ON d.id=p.document_id JOIN conversation_tasks t ON t.id=d.source_task_id WHERE p.material_version_id=? AND t.status='SUCCEEDED')",Boolean.class,version));}
    private Timestamp time(Instant i){return i==null?null:Timestamp.from(i);}
    private Instant instant(Map<String,Object> r,String k){return r.get(k)==null?null:((Timestamp)r.get(k)).toInstant();}
    private void authority(UUID actor,UUID tenant,UUID space){identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);if(space!=null)access.require(actor,tenant,space,false);}
    private void lock(UUID actor,UUID tenant){db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","briefing-generation-tenant:"+tenant);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","briefing-generation:"+tenant+":"+actor);}
    private UUID policy(UUID actor,UUID tenant,UUID space){
        db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id) VALUES(?,?,?,?) ON CONFLICT(tenant_id,owner_id,workspace_id) DO NOTHING",UUID.randomUUID(),tenant,actor,space);
        return db.queryForObject("SELECT id FROM briefing_generation_policies WHERE tenant_id=? AND owner_id=? AND workspace_id=?",UUID.class,tenant,actor,space);
    }
    private boolean spaceUsable(UUID actor,UUID tenant,UUID space){
        return manualDataBlock(actor,tenant,space,null)==null;
    }
    private UUID chooseSpace(UUID actor,UUID tenant,UUID requested){
        // An explicit space is only a preference. If it has no readable READY/PARTIAL evidence, land on
        // another authorized ready space instead of creating an immediate FAILED card.
        if(requested!=null){
            authority(actor,tenant,requested);
            if(spaceUsable(actor,tenant,requested))return requested;
        }
        var enrolled=db.queryForList("SELECT p.workspace_id FROM briefing_daily_schedules s JOIN briefing_generation_policies p ON p.id=s.policy_id JOIN tenant_governance g ON g.tenant_id=p.tenant_id AND g.owner_id=p.owner_id WHERE p.tenant_id=? AND p.owner_id=? AND s.enabled ORDER BY p.id",UUID.class,tenant,actor);
        if(!enrolled.isEmpty()&&(requested==null||spaceUsable(actor,tenant,enrolled.getFirst()))){authority(actor,tenant,enrolled.getFirst());return enrolled.getFirst();}
        var spaces=db.queryForList("""
          SELECT w.id FROM workspaces w WHERE w.tenant_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR EXISTS(
          SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=?))
          ORDER BY (SELECT max(b.created_at) FROM briefing_generation_batches b WHERE b.tenant_id=w.tenant_id AND b.workspace_id=w.id AND b.owner_id=?) ASC NULLS FIRST,w.kind='PERSONAL' DESC,w.id
          """,UUID.class,tenant,actor,actor,actor);
        if(spaces.isEmpty())throw new IdentityException(409,"BRIEFING_WORKSPACE_REQUIRED");
        // Rotate among authorized spaces; prefer usable evidence. Empty/unready spaces are skipped so a
        // multi-card manual request can land on a ready space; if every space fails, caller fails that card.
        UUID chosen=requested!=null?requested:spaces.getFirst(),pending=null;
        for(UUID candidate:spaces){
            var available=sources(actor,tenant,candidate);
            if(available.stream().noneMatch(s->Set.of("READY","PARTIAL").contains(s.parseStatus())))continue;
            if(pending==null)pending=candidate;
            if(available.stream().allMatch(s->Set.of("READY","PARTIAL").contains(s.parseStatus()))){chosen=candidate;authority(actor,tenant,chosen);return chosen;}
        }
        if(pending!=null)chosen=pending;
        authority(actor,tenant,chosen);return chosen;
    }
    private String manualGoalBlock(UUID actor,UUID tenant){
        var audience=workAudience.current(actor,tenant);
        if(audience.responsibilities().isBlank()&&audience.goals().governance().isBlank()&&audience.goals().stage().isBlank())return "WORK_GOAL_REQUIRED";
        return null;
    }
    /** Immediate fail reason for a manual card on this space; null means it may proceed to scheduling. */
    private String manualDataBlock(UUID actor,UUID tenant,UUID space,String type){
        if("INFO".equals(type))return null;
        var available=sources(actor,tenant,space);
        if(available.isEmpty())return "NO_MATERIALS";
        if(available.stream().noneMatch(s->Set.of("READY","PARTIAL").contains(s.parseStatus())))return "MATERIALS_NOT_READY";
        if(available.stream().anyMatch(s->!s.dataset()&&Set.of("READY","PARTIAL").contains(s.parseStatus())))return null;
        for(var source:available){
            if(!source.dataset()||!Set.of("READY","PARTIAL").contains(source.parseStatus()))continue;
            var ready=governance.analysisReadiness(actor,tenant,source.materialId(),source.versionId());
            if(!ready.ready())return ready.reason();
        }
        return null;
    }
    private void failManualIfBlocked(UUID actor,UUID tenant,UUID batch,UUID space,String type){
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE id=? AND task_id IS NOT NULL)",Boolean.class,batch)))return;
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE id=? AND status IN ('QUEUED','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY'))",Boolean.class,batch)))return;
        String goal=manualGoalBlock(actor,tenant);
        if(goal!=null){finish(batch,"FAILED",goal);return;}
        String data=manualDataBlock(actor,tenant,space,type);
        if(data!=null)finish(batch,"FAILED",data);
    }
    private void hold(UUID batch,boolean manual,String status,String reason){
        if(manual&&"WAITING_DATA".equals(status)&&MANUAL_TERMINAL_DATA.contains(reason))finish(batch,"FAILED",reason);
        else waiting(batch,status,reason);
    }
    @Transactional public Batch generate(UUID actor,UUID tenant,UUID request,UUID space,String type){
        authority(actor,tenant,null);if(request==null||type!=null&&!TYPES.contains(type))throw IdentityException.invalid();lock(actor,tenant);
        String fingerprint=IdentityService.hash(tenant+":"+space+":"+type);
        var prior=db.queryForList("SELECT batch_id,fingerprint FROM briefing_generation_requests WHERE tenant_id=? AND owner_id=? AND request_id=?",tenant,actor,request);
        if(!prior.isEmpty()){if(!prior.getFirst().get("fingerprint").equals(fingerprint))throw new IdentityException(409,"BRIEFING_REQUEST_CONFLICT");return get(actor,tenant,(UUID)prior.getFirst().get("batch_id"));}
        requireNews(tenant,type);
        UUID chosen=chooseSpace(actor,tenant,space),p=policy(actor,tenant,chosen);
        var active=db.queryForList("SELECT id FROM briefing_generation_batches WHERE tenant_id=? AND owner_id=? AND workspace_id=? AND coalesce(business_type,'AUTO')=coalesce(?,'AUTO') AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') ORDER BY created_at LIMIT 1",UUID.class,tenant,actor,chosen,type);
        UUID id=active.isEmpty()?enqueue(p,"GENERATE_MORE",type,null):active.getFirst();
        failManualIfBlocked(actor,tenant,id,chosen,type);
        db.update("INSERT INTO briefing_generation_requests VALUES(?,?,?,?,?)",tenant,actor,request,fingerprint,id);
        return get(actor,tenant,id);
    }
    private UUID selectionRequest(UUID request,int index){return UUID.nameUUIDFromBytes(("briefing-selection:"+request+":"+index).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    /** Reserve all requested runs atomically. A repeated confirmation replays the same batches. */
    @Transactional public List<Batch> generateSelection(UUID actor,UUID tenant,UUID request,UUID space,int count,List<String> types){
        authority(actor,tenant,null);
        if(request==null||count<1||count>6||types==null||types.size()>count||types.stream().anyMatch(t->t==null||!TYPES.contains(t))||new HashSet<>(types).size()!=types.size())throw IdentityException.invalid();
        lock(actor,tenant);
        String fingerprint=IdentityService.hash("selection:"+tenant+":"+space+":"+count+":"+types);
        var prior=db.queryForList("SELECT batch_id,fingerprint FROM briefing_generation_requests WHERE tenant_id=? AND owner_id=? AND request_id=?",tenant,actor,request);
        if(!prior.isEmpty()){
            if(!fingerprint.equals(prior.getFirst().get("fingerprint")))throw new IdentityException(409,"BRIEFING_REQUEST_CONFLICT");
            var result=new ArrayList<Batch>();for(int i=0;i<count;i++)result.add(get(actor,tenant,db.queryForObject("SELECT batch_id FROM briefing_generation_requests WHERE tenant_id=? AND owner_id=? AND request_id=?",UUID.class,tenant,actor,selectionRequest(request,i))));return result;
        }
        for(String type:types)requireNews(tenant,type);
        if(space!=null)authority(actor,tenant,space);
        if(count>quota(actor,tenant).remaining())throw new IdentityException(409,"BRIEFING_DAILY_QUOTA_EXCEEDED");
        var result=new ArrayList<Batch>();
        for(int i=0;i<count;i++){
            UUID chosen=chooseSpace(actor,tenant,space),p=policy(actor,tenant,chosen);
            String type=types.isEmpty()?null:types.get(i%types.size());UUID id=UUID.randomUUID();
            var active=count==1?db.queryForList("SELECT b.id FROM briefing_generation_batches b JOIN briefing_daily_schedules s ON s.policy_id=b.policy_id WHERE b.policy_id=? AND s.enabled AND coalesce(b.business_type,'AUTO')=coalesce(?,'AUTO') AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') ORDER BY b.created_at LIMIT 1",UUID.class,p,type):List.<UUID>of();
            if(!active.isEmpty())id=active.getFirst();
            else
            db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status,selection_id,selection_index,created_at) SELECT ?,tenant_id,owner_id,workspace_id,id,epoch,'GENERATE_MORE',?,'QUEUED',?,?,? FROM briefing_generation_policies WHERE id=?",id,type,request,i,time(clock.now().plusMillis(i)),p);
            failManualIfBlocked(actor,tenant,id,chosen,type);
            db.update("INSERT INTO briefing_generation_requests VALUES(?,?,?,?,?)",tenant,actor,selectionRequest(request,i),fingerprint,id);result.add(get(actor,tenant,id));
        }
        db.update("INSERT INTO briefing_generation_requests VALUES(?,?,?,?,?)",tenant,actor,request,fingerprint,result.getFirst().id());return result;
    }
    private static final String MANUAL_BATCH="(b.trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_generation_requests request WHERE request.batch_id=b.id))";
    @Value("${dreamcore.briefing.automatic-max-cards-per-day:8}") private int automaticDailyLimit=8;
    private Quota quota(UUID actor,UUID tenant){ return quota(actor,tenant,true); }
    private Quota quota(UUID actor,UUID tenant,boolean manual){
        Instant now=clock.now(),day=now.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant since=db.queryForObject("SELECT coalesce(max(reset_at),?) FROM briefing_quota_resets WHERE tenant_id=? AND owner_id=? AND reset_at>=? AND reset_at<=?",Timestamp.class,time(day),tenant,actor,time(day),time(now)).toInstant();
        if(!manual)since=day;
        int used=successfulCards(actor,tenant,since,manual);
        int reserved=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b LEFT JOIN conversation_tasks t ON t.id=b.task_id WHERE "+MANUAL_BATCH+"=? AND b.tenant_id=? AND b.owner_id=? AND ((b.task_id IS NULL AND b.status IN ('QUEUED','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')) OR t.status IN ('QUEUED','RUNNING'))",Integer.class,manual,tenant,actor);
        int limit=manual?dailyLimit:Math.max(1,Math.min(24,automaticDailyLimit));
        return new Quota(limit,used,reserved,Math.max(0,limit-used-reserved));
    }
    // Charge only a successful, audited card delivery. Failed prepared artifacts are not cards.
    // Historical delivery remains charged after a later source withdrawal or user deletion.
    private int successfulCards(UUID actor,UUID tenant,Instant since,boolean manual){
        return db.queryForObject("""
            SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id
            WHERE b.tenant_id=? AND b.owner_id=? AND b.started_at>=? AND t.status='SUCCEEDED' AND t.execution_class<>'external'
            AND %s=?
            AND EXISTS(SELECT 1 FROM conversation_artifacts a WHERE a.task_id=t.id AND a.attempt_number=t.attempt
                AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.tenant_id=a.tenant_id AND p.action='TASK_BRIEFING_CREATED' AND p.outcome='SUCCESS'))
            AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=t.id AND r.attempt_number=t.attempt AND r.name='deliver_briefing' AND r.status='succeeded')
            """.formatted(MANUAL_BATCH),Integer.class,tenant,actor,time(since),manual);
    }
    private UUID enqueue(UUID policy,String trigger,String type,Instant scheduled){
        UUID id=UUID.randomUUID();db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,scheduled_for,status) SELECT ?,tenant_id,owner_id,workspace_id,id,epoch,?,?,?,'QUEUED' FROM briefing_generation_policies WHERE id=?",id,trigger,type,time(scheduled),policy);return id;
    }
    private Batch map(Map<String,Object> r){
        UUID task=(UUID)r.get("task_id");List<UUID> cards=List.of();
        if(task!=null){var t=db.queryForList("SELECT attempt,status FROM conversation_tasks WHERE id=? AND EXISTS(SELECT 1 FROM readable_source_tasks s WHERE s.id=conversation_tasks.id)",task);
            if(!t.isEmpty()&&"SUCCEEDED".equals(t.getFirst().get("status"))&&contents.find(task,(Integer)t.getFirst().get("attempt"))!=null)cards=List.of(task);}
        return new Batch((UUID)r.get("id"),(UUID)r.get("workspace_id"),(String)r.get("trigger_kind"),(String)r.get("business_type"),(String)r.get("status"),(String)r.get("reason"),task,cards,instant(r,"created_at"),instant(r,"finished_at"));
    }
    @Transactional public Batch get(UUID actor,UUID tenant,UUID id){
        authority(actor,tenant,null);var rows=db.queryForList("SELECT * FROM briefing_generation_batches WHERE id=? AND tenant_id=? AND owner_id=?",id,tenant,actor);
        if(rows.isEmpty())throw new IdentityException(404,"BRIEFING_BATCH_NOT_FOUND");authority(actor,tenant,(UUID)rows.getFirst().get("workspace_id"));return map(rows.getFirst());
    }
    @Transactional public State state(UUID actor,UUID tenant){
        authority(actor,tenant,null);var policies=new ArrayList<Policy>();var batches=new ArrayList<Batch>();
        for(var p:db.queryForList("SELECT * FROM briefing_generation_policies WHERE tenant_id=? AND owner_id=? ORDER BY created_at",tenant,actor)){
            try{access.require(actor,tenant,(UUID)p.get("workspace_id"),false);}catch(IdentityException e){continue;}
            policies.add(new Policy((UUID)p.get("id"),(UUID)p.get("workspace_id"),db.queryForObject("SELECT name FROM workspaces WHERE id=?",String.class,p.get("workspace_id")),(Boolean)p.get("enabled"),(Integer)p.get("revision"),(String)p.get("reason")));
            for(var b:db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? ORDER BY created_at DESC,id DESC LIMIT 5",p.get("id")))batches.add(map(b));
        }
        batches.sort(Comparator.comparing(Batch::createdAt).reversed());return new State(policies,batches.stream().limit(20).toList(),quota(actor,tenant),Map.of("INFO",newsCapability(tenant)),quota(actor,tenant,false));
    }
    @Transactional public Policy configure(UUID actor,UUID tenant,UUID space,int revision,boolean enabled){
        authority(actor,tenant,space);lock(actor,tenant);UUID id=policy(actor,tenant,space);
        var p=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=? FOR UPDATE",id);
        if((Integer)p.get("revision")!=revision)throw new IdentityException(409,"BRIEFING_POLICY_CHANGED");
        // Pause future work; current batches retain their own cancellation control.
        db.update("UPDATE briefing_generation_policies SET enabled=?,revision=revision+1 WHERE id=?",enabled,id);
        return new Policy(id,space,db.queryForObject("SELECT name FROM workspaces WHERE id=?",String.class,space),enabled,revision+1,(String)p.get("reason"));
    }
    @Transactional public Batch cancel(UUID actor,UUID tenant,UUID id){
        get(actor,tenant,id);lock(actor,tenant);
        UUID selection=db.queryForObject("SELECT selection_id FROM briefing_generation_batches WHERE id=?",UUID.class,id);
        List<UUID> ids=selection==null?List.of(id):db.queryForList("SELECT id FROM briefing_generation_batches WHERE tenant_id=? AND owner_id=? AND selection_id=? ORDER BY selection_index",UUID.class,tenant,actor,selection);
        for(UUID member:ids){var b=get(actor,tenant,member);if(OPEN.contains(b.status())){
            if(b.taskId()!=null)tasks.interruptTasks(tenant,List.of(b.taskId()),"BRIEFING_CANCELLED");
            finish(member,"CANCELLED","USER_CANCELLED");
        }}return get(actor,tenant,id);
    }
    /** Bounded discovery also covers existing users after an upgrade. No page read creates work. */
    @Transactional public void discover(){
        db.update("""
          INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id)
          SELECT gen_random_uuid(),w.tenant_id,m.account_id,w.id FROM workspaces w
          JOIN tenant_memberships m ON m.tenant_id=w.tenant_id AND m.status='ACTIVE'
          JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE' JOIN tenants t ON t.id=w.tenant_id AND t.status='ACTIVE'
          WHERE ((w.kind='PERSONAL' AND w.owner_id=m.account_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.account_id=m.account_id))
          AND NOT EXISTS(SELECT 1 FROM briefing_generation_policies p WHERE p.tenant_id=w.tenant_id AND p.owner_id=m.account_id AND p.workspace_id=w.id)
          ORDER BY w.id,m.account_id LIMIT 100 ON CONFLICT DO NOTHING
          """);
    }
    /** Oldest first within each enterprise, then interleave enterprises before taking another slot. */
    public List<UUID> candidates(){return db.queryForList("WITH eligible AS (SELECT id,tenant_id,checked_at FROM briefing_generation_policies WHERE ((? OR (tenant_id::text=? AND owner_id::text=?)) AND enabled AND (next_idle_check_at IS NULL OR next_idle_check_at<=?)) OR EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.policy_id=briefing_generation_policies.id AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND (? OR (b.tenant_id::text=? AND b.owner_id::text=?) OR b.trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_daily_runs daily WHERE daily.batch_id=b.id) OR EXISTS(SELECT 1 FROM briefing_daily_retries retry WHERE retry.batch_id=b.id) OR EXISTS(SELECT 1 FROM briefing_generation_requests request WHERE request.batch_id=b.id)))), ranked AS (SELECT *,row_number() OVER(PARTITION BY tenant_id ORDER BY checked_at NULLS FIRST,id) AS turn FROM eligible) SELECT id FROM ranked ORDER BY turn,checked_at NULLS FIRST,id LIMIT 20",UUID.class,automaticEnabled,onceTenant,onceOwner,time(clock.now()),automaticEnabled,onceTenant,onceOwner);}

    /** One transaction per advancement. Idle backoff never delays an existing batch. */
    @Transactional public boolean advance(UUID id){
        var identity=db.queryForList("SELECT tenant_id,owner_id FROM briefing_generation_policies WHERE id=?",id);
        if(identity.isEmpty())return false;
        UUID tenant=(UUID)identity.getFirst().get("tenant_id");
        lock((UUID)identity.getFirst().get("owner_id"),tenant);
        var policy=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=? AND tenant_id=? FOR UPDATE",id,tenant);
        var before=openBatchState(tenant,id);
        Instant now=clock.now(),due=instant(policy,"next_idle_check_at");
        if(before.isEmpty()&&due!=null&&due.isAfter(now))return false;
        tick(id);
        var after=openBatchState(tenant,id);
        boolean progressed=!before.equals(after);
        int delay=after.isEmpty()&&!progressed?Math.min(60,Math.max(5,((Number)policy.get("idle_check_seconds")).intValue()*2)):0;
        db.update("UPDATE briefing_generation_policies SET idle_check_seconds=?,next_idle_check_at=? WHERE id=? AND tenant_id=?",delay,time(clock.now().plusSeconds(delay)),id,tenant);
        return progressed;
    }
    private List<Map<String,Object>> openBatchState(UUID tenant,UUID policy){
        // Indexed by policy; only unfinished work, never historical content or cached authorization.
        return db.queryForList("SELECT id,status,task_id FROM briefing_generation_batches WHERE tenant_id=? AND policy_id=? AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') ORDER BY id",tenant,policy);
    }

    private List<Source> sources(UUID actor,UUID tenant,UUID space){var sources=new ArrayList<>(db.query("""
        SELECT m.id,v.id version_id,v.filename,v.created_at,coalesce(k.status,'NOT_REQUESTED') parse_status FROM active_materials m
        JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
        LEFT JOIN LATERAL(SELECT status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) k ON true
        WHERE m.tenant_id=? AND m.workspace_id=? AND m.in_library
         AND NOT EXISTS(SELECT 1 FROM file_table_sources f JOIN business_datasets d ON d.id=f.dataset_id WHERE f.material_id=m.id AND d.status='ACTIVE' AND file_dataset_readable(?::uuid,d.id))
         ORDER BY m.id LIMIT 1001
        """,(r,n)->new Source(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),r.getString("parse_status"),r.getTimestamp("created_at").toInstant(),space),tenant,space,actor));
        sources.addAll(db.query("""
          SELECT d.id,s.id snapshot_id,d.name,s.collected_at FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot
          WHERE d.tenant_id=? AND d.workspace_id=? AND d.status='ACTIVE' AND file_dataset_readable(?::uuid,d.id) AND NOT d.scrubbed AND NOT s.scrubbed ORDER BY d.id LIMIT 1001
          """,(r,n)->new Source(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),"READY",r.getTimestamp(4).toInstant(),"DATASET",space),tenant,space,actor));
        return sources.stream().sorted(Comparator.comparing(Source::kind).thenComparing(Source::materialId)).limit(1001).toList();
    }
    /** Reading scope follows the actor's current permissions, independently of the output workspace. */
    private List<Source> authorizedSources(UUID actor,UUID tenant){
        var spaces=db.queryForList("""
          SELECT w.id FROM workspaces w
          WHERE w.tenant_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR
            (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?)))
            AND departure_content_readable(?,w.tenant_id,w.id) ORDER BY w.id
          """,UUID.class,tenant,actor,actor,actor);
        var available=new ArrayList<Source>();
        for(UUID sourceSpace:spaces){
            available.addAll(sources(actor,tenant,sourceSpace));
            if(available.size()>1000)break;
        }
        return available.stream().sorted(Comparator.comparing(Source::kind).thenComparing(Source::materialId)).limit(1001).toList();
    }
    /** Take evidence from distinct readable spaces before filling remaining slots from one space. */
    private List<Source> selectSources(List<Source> ordered,UUID outputSpace){
        var groups=new LinkedHashMap<UUID,List<Source>>();
        for(var source:ordered)groups.computeIfAbsent(source.workspaceId(),unused->new ArrayList<>()).add(source);
        var spaces=new ArrayList<>(groups.keySet());
        if(spaces.remove(outputSpace))spaces.addFirst(outputSpace);
        var chosen=new ArrayList<Source>();
        for(int round=0;chosen.size()<3;round++){
            boolean added=false;
            for(UUID sourceSpace:spaces){var group=groups.get(sourceSpace);if(round<group.size()){chosen.add(group.get(round));added=true;if(chosen.size()==3)break;}}
            if(!added)break;
        }
        return List.copyOf(chosen);
    }
    private String fingerprint(List<Source> sources){return IdentityService.hash(json.writeValueAsString(sources.stream().map(s->List.of(s.kind(),s.materialId(),s.versionId())).toList()));}
    private void waiting(UUID batch,String status,String reason){db.update("UPDATE briefing_generation_batches SET status=?,reason=? WHERE id=?",status,reason,batch);}
    private void finish(UUID batch,String status,String reason){db.update("UPDATE briefing_generation_batches SET status=?,reason=?,finished_at=? WHERE id=?",status,reason,time(clock.now()),batch);}
    @Transactional public void tick(UUID id){
        var rows=db.queryForList("SELECT * FROM briefing_generation_policies WHERE id=?",id);if(rows.isEmpty())return;var p=rows.getFirst();
        UUID tenant=(UUID)p.get("tenant_id"),actor=(UUID)p.get("owner_id"),space=(UUID)p.get("workspace_id");lock(actor,tenant);
        boolean automaticAllowed=automaticAllowed(tenant,actor);
        String newsSource=newsSource(tenant);
        p=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=? FOR UPDATE",id);Instant now=clock.now();
        db.update("UPDATE briefing_generation_policies SET checked_at=? WHERE id=?",time(now),id);
        if("SUSPENDED".equals(db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant))){db.update("UPDATE briefing_generation_policies SET reason='TENANT_SERVICE_SUSPENDED' WHERE id=?",id);return;}
        // A missing installation prerequisite is terminal for a manual request, not an endless reservation.
        if(!newsCapability(tenant).available())db.update("UPDATE briefing_generation_batches SET status='FAILED',reason='NEWS_SOURCE_UNAVAILABLE',finished_at=? WHERE policy_id=? AND business_type='INFO' AND task_id IS NULL AND status IN ('QUEUED','WAITING_DATA','WAITING_CAPABILITY')",time(now),id);
        var dispatched=db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')",id);
        for(var prior:dispatched)reconcile(p,prior);
        var active=db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NULL AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND (? OR trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_daily_runs daily WHERE daily.batch_id=briefing_generation_batches.id) OR EXISTS(SELECT 1 FROM briefing_daily_retries retry WHERE retry.batch_id=briefing_generation_batches.id) OR EXISTS(SELECT 1 FROM briefing_generation_requests request WHERE request.batch_id=briefing_generation_batches.id)) AND NOT (coalesce(business_type,'AUTO')='INFO' AND status='WAITING_DATA' AND reason='NEWS_SOURCE_UNAVAILABLE' AND ?) ORDER BY CASE WHEN task_id IS NOT NULL THEN 0 ELSE 1 END,CASE WHEN trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_generation_requests manual WHERE manual.batch_id=briefing_generation_batches.id) THEN 0 ELSE 1 END,coalesce(selection_index,0),CASE WHEN business_type='INFO' THEN 0 ELSE 1 END,created_at LIMIT 1 FOR UPDATE",id,automaticAllowed,newsSource.isBlank()||!agents.publicWebEnabled());
        try{authority(actor,tenant,space);}catch(IdentityException e){
            for(var b:active){if(b.get("task_id")!=null)tasks.interruptTasks(tenant,List.of((UUID)b.get("task_id")),"BRIEFING_AUTHORITY_REVOKED");finish((UUID)b.get("id"),"AUTHORITY_REVOKED","AUTHORITY_REVOKED");}
            db.update("UPDATE briefing_generation_policies SET reason='AUTHORITY_REVOKED' WHERE id=?",id);return;
        }
        if(!active.isEmpty()&&active.getFirst().get("task_id")!=null){
            reconcile(p,active.getFirst());return;
        }
        // A user-requested batch plans once, then executes card tasks sequentially across spaces.
        if(!active.isEmpty()&&active.getFirst().get("selection_id")!=null){
            var current=active.getFirst();UUID selection=(UUID)current.get("selection_id");
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE selection_id=? AND selection_index<? AND status NOT IN ('SUCCEEDED','NO_NEW_CONTENT','FAILED','CANCELLED','AUTHORITY_REVOKED'))",Boolean.class,selection,current.get("selection_index"))))return;
            var plans=db.queryForList("SELECT body::text FROM briefing_editorial_batches WHERE id=? AND tenant_id=? AND owner_id=?",String.class,selection,tenant,actor);
            if(!plans.isEmpty()&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_editorial_batches b CROSS JOIN LATERAL jsonb_array_elements(b.body->'plan'->'items') WITH ORDINALITY i(item,n) WHERE b.id=? AND i.item->>'decision'='EMIT' AND (CAST(? AS text) IS NULL OR b.body->'candidates'->(i.n::int-1)->>'businessType'=?) AND NOT EXISTS(SELECT 1 FROM briefing_editorial_tasks t WHERE t.batch_id=b.id AND t.selected_index=i.n-1))",Boolean.class,selection,current.get("business_type"),current.get("business_type")))){finish((UUID)current.get("id"),"NO_NEW_CONTENT","EDITORIAL_PLAN_EXHAUSTED");return;}
        }
        // Reconciliation already checked the dispatched tasks. Waiting for a consumer is not
        // a reason to rehash the entire source pool on every scheduler poll.
        if(active.isEmpty()&&!dispatched.isEmpty())return;
        var enrollment=db.queryForList("SELECT * FROM briefing_daily_schedules WHERE policy_id=?",id);
        boolean enrolled=!enrollment.isEmpty();
        if(active.isEmpty()&&(enrolled||!automaticAllowed))return;
        if(enrolled&&!active.isEmpty()){
            var batch=active.getFirst();
            if(!dailyEnabled||!Boolean.TRUE.equals(enrollment.getFirst().get("enabled"))||!actor.equals(db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant))){finish((UUID)batch.get("id"),"AUTHORITY_REVOKED","SCHEDULE_AUTHORITY_CHANGED");return;}
            if(instant(batch,"created_at").plusSeconds(900).isBefore(now)){finish((UUID)batch.get("id"),"FAILED","GENERATION_DEADLINE_EXCEEDED");return;}
        }
        List<Source> sources=enrolled?sources(actor,tenant,space):authorizedSources(actor,tenant);
        var bootstrapKeys=db.queryForList("SELECT dataset_key FROM briefing_bootstrap_scopes WHERE policy_id=?",String.class,id);
        boolean bootstrapScoped=!bootstrapKeys.isEmpty();
        if(bootstrapScoped)sources=sources.stream().filter(source->source.dataset()&&bootstrapKeys.contains(db.queryForObject("SELECT dataset_key FROM business_datasets WHERE id=?",String.class,source.materialId()))).toList();
        String contextKey=contextKey(actor,tenant,space);
        var contentKeys=new HashMap<UUID,String>();
        var readiness = new HashMap<UUID,com.dreamcore.workspace.governance.GovernanceModelService.AnalysisReadiness>();
        for(var source:sources) {
            var ready = source.dataset() ? governance.analysisReadiness(actor,tenant,source.materialId(),source.versionId()) : null;
            if(ready!=null)readiness.put(source.materialId(),ready);
            contentKeys.put(source.materialId(),governedContentKey(actor,tenant,source,ready));
        }
        // A fresh collection receipt is not a business change. Keep exact snapshots for execution,
        // but use content plus semantics for automatic scheduling.
        String key=IdentityService.hash("automatic-analysis-v2:"+json.writeValueAsString(sources.stream().map(source->source.kind()+":"+source.materialId()+":"+contentKeys.get(source.materialId())).sorted().toList())+contextKey);
        Instant resumed=db.queryForObject("SELECT service_resumed_at FROM tenants WHERE id=?",(r,n)->r.getTimestamp(1)==null?null:r.getTimestamp(1).toInstant(),tenant);
        Set<String> seenContent=new HashSet<>(db.queryForList("SELECT coalesce(v->>'datasetId',v->>'materialId')||':'||(v->>'contentKey') FROM briefing_generation_batches b CROSS JOIN LATERAL jsonb_array_elements(b.source_versions) v WHERE b.policy_id=? AND b.status IN ('SUCCEEDED','NO_NEW_CONTENT') AND v->>'contentKey' IS NOT NULL",String.class,id));
        var unseen=sources.stream().filter(source->Set.of("READY","PARTIAL").contains(source.parseStatus())).filter(source->!seenContent.contains(source.materialId()+":"+contentKeys.get(source.materialId())) && (resumed==null||source.changedAt().isAfter(resumed))).toList();
        if(Boolean.TRUE.equals(p.get("service_resume_pending"))){
            db.update("UPDATE briefing_generation_policies SET context_key=?,service_resume_pending=false WHERE id=?",contextKey,id);
            p.put("context_key",contextKey);
        }
        if(active.isEmpty()){
            if(!dispatched.isEmpty())return;
            if(enrolled||!automaticAllowed||!Boolean.TRUE.equals(p.get("enabled")))return;
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL AND status IN ('QUEUED','RUNNING'))",Boolean.class,id)))return;
            // Same actor + same currently authorized source pool + same context: do not launch
            // another automatic analysis merely because a second workspace has a policy.
            boolean equivalentPolicy=equivalentAutomaticAnalysis(tenant,actor,id,key,space);
            if(equivalentPolicy){db.update("UPDATE briefing_generation_policies SET reason='EQUIVALENT_ANALYSIS_EXISTS' WHERE id=?",id);return;}
            // Failed/cancelled automatic runs require an explicit retry; new source versions may proceed.
            boolean goalChanged=unseen.isEmpty()&&p.get("context_key")!=null&&!p.get("context_key").equals(contextKey);
            boolean changed=!unseen.isEmpty()||goalChanged;
            boolean failedSame=db.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM briefing_generation_batches failed
                WHERE failed.policy_id=? AND failed.source_key=? AND failed.status IN ('FAILED','CANCELLED','AUTHORITY_REVOKED')
                AND failed.trigger_kind<>'GENERATE_MORE' AND NOT EXISTS(
                  SELECT 1 FROM briefing_generation_batches recovered WHERE recovered.policy_id=failed.policy_id
                  AND recovered.source_key=failed.source_key AND coalesce(recovered.business_type,'AUTO')<>'INFO'
                  AND recovered.status IN ('SUCCEEDED','NO_NEW_CONTENT') AND recovered.finished_at>failed.finished_at))
                """,Boolean.class,id,key);
            if(changed&&!failedSame&&!sources.isEmpty()){
                boolean result=unseen.stream().anyMatch(source->!source.dataset()&&completedPublication(source.versionId()));
                enqueue(id,p.get("data_key")==null?"INITIALIZATION":goalChanged?"CONTEXT_CHANGED":result?"RESULT_READY":"DATA_READY",goalChanged?"SUGGESTION":result?"RESULT":null,null);
            }
            else if(!bootstrapScoped&&newsCapability(tenant).available()&&!newsSource.isBlank()&&agents.publicWebEnabled()&&(now.atZone(ZoneId.of("Asia/Shanghai")).getHour()>=9) && (p.get("info_day")==null||!((java.sql.Date)p.get("info_day")).toLocalDate().equals(now.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()))){
                var date=now.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate();
                boolean exists=db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE policy_id=? AND business_type='INFO' AND scheduled_for=?)",Boolean.class,id,time(date.atTime(9,0).atZone(ZoneId.of("Asia/Shanghai")).toInstant()));
                if(exists)return;enqueue(id,p.get("info_day")==null?"INITIALIZATION":"SCHEDULE","INFO",date.atTime(9,0).atZone(ZoneId.of("Asia/Shanghai")).toInstant());
            }else{db.update("UPDATE briefing_generation_policies SET reason=? WHERE id=?",sources.isEmpty()?"WAITING_DATA":failedSame?"ANALYSIS_RETRY_REQUIRED":newsSource.isBlank()||!agents.publicWebEnabled()?"NEWS_SOURCE_UNAVAILABLE":"NO_NEW_VERSION",id);return;}
            active=db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? AND status='QUEUED' ORDER BY created_at DESC LIMIT 1",id);
        }
        var b=active.getFirst();UUID batch=(UUID)b.get("id");String type=(String)b.get("business_type");boolean info="INFO".equals(type);
        boolean manualBatch="GENERATE_MORE".equals(b.get("trigger_kind"))||Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_requests WHERE batch_id=?)",Boolean.class,batch));
        // Stock manual waits that cannot self-heal: fail and release the selection slot.
        if(manualBatch&&"WAITING_DATA".equals(b.get("status"))&&MANUAL_TERMINAL_DATA.contains(Objects.toString(b.get("reason"),""))){
            finish(batch,"FAILED",Objects.toString(b.get("reason"),"NO_MATERIALS"));return;
        }
        // Reserve the semantic source key before event merging, so another workspace cannot queue the same work.
        if(!info)db.update("UPDATE briefing_generation_batches SET source_key=?,context_key=? WHERE id=? AND task_id IS NULL",key,contextKey,batch);
        if(info&&newsCatalog!=null&&(newsSearch==null||!newsSearch.enabled()))newsSource=newsCatalog.sourceFor(tenant,batch);
        if(!p.get("epoch").equals(b.get("policy_epoch"))){finish(batch,"AUTHORITY_REVOKED","AUTHORITY_CHANGED");return;}
        if(info&&(newsSource.isBlank()||!agents.publicWebEnabled())){hold(batch,manualBatch,"WAITING_DATA","NEWS_SOURCE_UNAVAILABLE");return;}
        if(!info){
            if(sources.isEmpty()){hold(batch,manualBatch,"WAITING_DATA","NO_MATERIALS");return;}
            if(sources.size()>1000){waiting(batch,"WAITING_RESOURCE","SOURCE_COUNT_LIMIT");return;}
            if(sources.stream().noneMatch(s->Set.of("READY","PARTIAL").contains(s.parseStatus()))){hold(batch,manualBatch,"WAITING_DATA","MATERIALS_NOT_READY");return;}
            if(sources.stream().filter(s->Set.of("READY","PARTIAL").contains(s.parseStatus())).anyMatch(s->s.changedAt().plusSeconds(mergeSeconds).isAfter(now))){waiting(batch,"WAITING_DATA","MERGING_DATA_EVENTS");return;}
        }
        if(!tasksEnabled||!agents.enabled()){waiting(batch,"WAITING_CAPABILITY","MODEL_NOT_CONFIGURED");return;}
        var audience=workAudience.current(actor,tenant);
        if(audience.responsibilities().isBlank()&&audience.goals().governance().isBlank()&&audience.goals().stage().isBlank()){
            hold(batch,manualBatch,"WAITING_DATA","WORK_GOAL_REQUIRED");return;
        }
        Instant day=now.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
        // The latest reset within this UTC day starts a new owner budget without rewriting history.
        Instant ownerSince=db.queryForObject("SELECT coalesce(max(reset_at),?) FROM briefing_quota_resets WHERE tenant_id=? AND owner_id=? AND reset_at>=? AND reset_at<=?",Timestamp.class,time(day),tenant,actor,time(day),time(now)).toInstant();
        if(!manualBatch&&!enrolled&&!info&&equivalentAutomaticAnalysis(tenant,actor,id,key,space)){
            finish(batch,"CANCELLED","EQUIVALENT_ANALYSIS_EXISTS");return;
        }
        int categoryExecuting=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.owner_id=? AND "+MANUAL_BATCH+"=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,tenant,actor,manualBatch);
        int executionLimit=manualBatch?dailyLimit:Math.max(1,Math.min(24,automaticDailyLimit));
        int used=successfulCards(actor,tenant,manualBatch?ownerSince:day,manualBatch);
        int concurrent=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.owner_id=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,tenant,actor);
        int tenantUsed=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.started_at>=? AND t.execution_class<>'external'",Integer.class,tenant,time(day));
        int tenantConcurrent=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,tenant);
        if(used+categoryExecuting>=executionLimit||concurrent>=5||tenantUsed>=48||tenantConcurrent>=20){waiting(batch,"WAITING_RESOURCE",used+categoryExecuting>=executionLimit?(manualBatch?"DAILY_RUN_LIMIT":"AUTOMATIC_DAILY_LIMIT"):tenantUsed>=48?"TENANT_DAILY_LIMIT":tenantConcurrent>=20?"TENANT_CONCURRENCY_LIMIT":"OWNER_CONCURRENCY_LIMIT");return;}
        // One complete topic per batch. Explicit bounded source selection is visible to the model and reader.
        var order=Comparator.comparingInt((Source s)->workAudience.sourceScore(audience,s.filename())).reversed().thenComparing(Source::changedAt,Comparator.reverseOrder()).thenComparing(Source::filename);
        List<Source> selected=selectSources((info||unseen.isEmpty()?sources:unseen).stream().filter(s->Set.of("READY","PARTIAL").contains(s.parseStatus())).filter(s->!"RESULT".equals(type)||!s.dataset()&&completedPublication(s.versionId())).sorted(order).toList(),space);
        // Qualitative briefings can use document evidence without selecting unrelated stale datasets.
        if("INSIGHT".equals(type)||"SUGGESTION".equals(type)){
            var documents=sources.stream().filter(s->!s.dataset()&&Set.of("READY","PARTIAL").contains(s.parseStatus())).sorted(Comparator.comparing((Source s)->seenContent.contains(s.materialId()+":"+contentKeys.get(s.materialId()))).thenComparing(order)).toList();
            if(!documents.isEmpty())selected=selectSources(documents,space);
        }
        if(bootstrapScoped)selected=selected.stream().limit(1).toList();
        // An unchanged current workbook can ground a new topic; consumption is not a ban on reuse.
        // Keep two unseen documents, the authorized source pool and the three-version bound.
        if((type==null||"DATA".equals(type))&&selected.stream().noneMatch(this::workbook)){
            var reference=sources.stream().filter(s->Set.of("READY","PARTIAL").contains(s.parseStatus())).filter(this::workbook).sorted(order).findFirst();
            if(reference.isPresent()){
                var grounded=new ArrayList<Source>();grounded.add(reference.get());grounded.addAll(selected.stream().limit(2).toList());selected=List.copyOf(grounded);
            }
        }
        if(enrolled&&type==null&&selected.stream().filter(Source::dataset).anyMatch(source->{
            Timestamp coverage=db.queryForObject("SELECT coverage_through FROM dataset_snapshots WHERE id=?",Timestamp.class,source.versionId());
            return coverage==null||coverage.toInstant().isBefore(now.minusSeconds(7200));
        })){
            var documents=sources.stream().filter(s->!s.dataset()&&Set.of("READY","PARTIAL").contains(s.parseStatus())).sorted(Comparator.comparing((Source s)->seenContent.contains(s.materialId()+":"+contentKeys.get(s.materialId()))).thenComparing(order)).toList();
            if(!documents.isEmpty())selected=selectSources(documents,space);
        }
        if(enrolled&&!info)for(var source:selected)if(source.dataset()){
            Timestamp coverage=db.queryForObject("SELECT coverage_through FROM dataset_snapshots WHERE id=?",Timestamp.class,source.versionId());
            if(coverage==null||coverage.toInstant().isBefore(now.minusSeconds(7200))){hold(batch,manualBatch,"WAITING_DATA","SOURCE_COVERAGE_TOO_OLD");return;}
        }
        if(selected.isEmpty()&&!info){hold(batch,manualBatch,"WAITING_DATA","RESULT_NOT_READY");return;}
        if(!info)for(var source:selected)if(source.dataset()) {
            var ready=readiness.get(source.materialId());
            if(ready!=null&&!ready.ready()) {
                hold(batch,manualBatch,"WAITING_DATA",ready.reason());
                db.update("UPDATE briefing_generation_policies SET reason=? WHERE id=?",ready.reason(),id);
                return;
            }
        }
        if(enrolled&&!info){
            var evidence=new ArrayList<Object>();
            for(var source:selected){
                if(source.dataset()){
                    evidence.add(List.of(source.materialId(),contentKeys.get(source.materialId())));
                }else evidence.add(List.of(source.materialId(),source.versionId()));
            }
            key=IdentityService.hash(json.writeValueAsString(evidence)+contextKey+type);
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE policy_id=? AND source_key=? AND (status='SUCCEEDED' OR (? AND status='NO_NEW_CONTENT')))",Boolean.class,id,key,!manualBatch))){
                db.update("UPDATE briefing_generation_batches SET source_key=?,context_key=?,source_versions=?::jsonb WHERE id=?",key,contextKey,json.writeValueAsString(selected.stream().map(source->selection(source,contentKeys.get(source.materialId()))).toList()),batch);
                finish(batch,"NO_NEW_CONTENT","SOURCES_UNCHANGED");return;
            }
        }
        String prompt=BriefingTaskPrompt.compose(Objects.toString(b.get("trigger_kind"),""),type,
            selected.stream().map(s->s.kind()+":"+s.filename()).toList(),recent(actor,tenant,space));
        var detail=tasks.submitBriefing(actor,tenant,space,batch,prompt,info?newsSource:null,selected.stream().filter(s->!s.dataset()).map(s->new TaskOriginals.Selection(s.materialId(),s.versionId())).toList());
        UUID task=detail.tasks().getLast().id();
        if(info&&com.dreamcore.workspace.news.NewsSearchPolicy.QUERY.equals(newsSource))newsSearch.pin(task,tenant);
        db.update("UPDATE briefing_generation_batches SET audience_key=work_audience_key(tenant_id,owner_id),task_id=?,status='RUNNING',reason=NULL,source_key=?,context_key=?,source_versions=?::jsonb,started_at=? WHERE id=?",task,key,contextKey,json.writeValueAsString(selected.stream().map(source->selection(source,contentKeys.get(source.materialId()))).toList()),time(now),batch);
        for(var source:selected)if(source.dataset())db.update("INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id) VALUES (?,?,?,?)",task,batch,source.materialId(),source.versionId());
        if(enrolled)db.update("INSERT INTO briefing_flow_tasks(task_id,policy_id,schedule_revision,column_hashes) SELECT ?,?,?,coalesce((SELECT jsonb_object_agg(d.id::text,md5(d.column_names::text)) FROM briefing_dataset_selections x JOIN business_datasets d ON d.id=x.dataset_id WHERE x.task_id=?),'{}'::jsonb)",task,id,enrollment.getFirst().get("revision"),task);
        db.update("UPDATE briefing_generation_policies SET reason=NULL WHERE id=?",id);
    }
    public record Daily(UUID workspaceId,boolean enabled,int revision,String localTime,String zone,Instant nextDue) {}
    private static final ZoneId DAILY_ZONE=ZoneId.of("Asia/Shanghai");
    private void owner(UUID actor,UUID tenant){authority(actor,tenant,null);if(identities.supportAccess(actor,tenant)||!actor.equals(db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant)))throw new IdentityException(403,"BRIEFING_OWNER_REQUIRED");}
    @Transactional public Daily daily(UUID actor,UUID tenant,UUID space){
        owner(actor,tenant);authority(actor,tenant,space);
        var rows=db.queryForList("SELECT s.* FROM briefing_daily_schedules s JOIN briefing_generation_policies p ON p.id=s.policy_id WHERE p.tenant_id=? AND p.owner_id=? AND p.workspace_id=?",tenant,actor,space);
        if(rows.isEmpty())return new Daily(space,false,0,"09:00","Asia/Shanghai",null);
        var r=rows.getFirst();return new Daily(space,(Boolean)r.get("enabled"),(Integer)r.get("revision"),r.get("local_time").toString(),"Asia/Shanghai",instant(r,"next_due"));
    }
    @Transactional public Daily configureDaily(UUID actor,UUID tenant,UUID space,int revision,boolean enabled,Instant firstRunAt){
        owner(actor,tenant);authority(actor,tenant,space);lock(actor,tenant);
        if(space==null||revision<0||enabled&&!dailyEnabled)throw new IdentityException(409,"BRIEFING_DAILY_NOT_AVAILABLE");
        if(firstRunAt!=null&&(!firstRunAt.isAfter(clock.now())||firstRunAt.isAfter(clock.now().plusSeconds(86400))))throw IdentityException.invalid();
        UUID p=policy(actor,tenant,space);var before=daily(actor,tenant,space);
        if(before.revision()!=revision)throw new IdentityException(409,"BRIEFING_SCHEDULE_CHANGED");
        Instant due=firstRunAt==null?nextDaily(clock.now()):firstRunAt;
        if(firstRunAt!=null){
            var day=java.sql.Date.valueOf(firstRunAt.atZone(DAILY_ZONE).toLocalDate());
            var prior=db.queryForList("SELECT b.status FROM briefing_daily_runs r JOIN briefing_generation_batches b ON b.id=r.batch_id WHERE r.policy_id=? AND r.local_day=?",String.class,p,day);
            if(!prior.isEmpty()){
                if(!Set.of("FAILED","CANCELLED","AUTHORITY_REVOKED").contains(prior.getFirst())||db.queryForObject("SELECT count(*) FROM briefing_daily_retries WHERE policy_id=? AND local_day=?",Integer.class,p,day)>0)throw new IdentityException(409,"BRIEFING_DAILY_ALREADY_ATTEMPTED");
                db.update("INSERT INTO briefing_daily_retries(policy_id,local_day,scheduled_for) VALUES (?,?,?)",p,day,time(firstRunAt));
            }
        }
        db.update("INSERT INTO briefing_daily_schedules(policy_id,enabled,next_due) VALUES (?,?,?) ON CONFLICT(policy_id) DO UPDATE SET enabled=excluded.enabled,next_due=excluded.next_due,revision=briefing_daily_schedules.revision+1,updated_at=now()",p,enabled,time(due));
        if(dailyAudit!=null)dailyAudit.record(actor,tenant,enabled?"BRIEFING_DAILY_ENABLED":"BRIEFING_DAILY_DISABLED",p,"SUCCESS");
        return daily(actor,tenant,space);
    }
    private Instant nextDaily(Instant after){var day=after.atZone(DAILY_ZONE).toLocalDate();var due=day.atTime(9,0).atZone(DAILY_ZONE).toInstant();return due.isAfter(after)?due:day.plusDays(1).atTime(9,0).atZone(DAILY_ZONE).toInstant();}
    public List<UUID> dueDaily(){return dailyEnabled?db.queryForList("SELECT policy_id FROM briefing_daily_schedules WHERE enabled AND next_due<=? ORDER BY next_due LIMIT 20",UUID.class,time(clock.now())):List.of();}
    @Transactional public void dispatchDaily(UUID id){
        if(!dailyEnabled)return;
        var p=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",id);
        UUID actor=(UUID)p.get("owner_id"),tenant=(UUID)p.get("tenant_id"),space=(UUID)p.get("workspace_id");lock(actor,tenant);
        var s=db.queryForMap("SELECT * FROM briefing_daily_schedules WHERE policy_id=? FOR UPDATE",id);Instant now=clock.now(),due=instant(s,"next_due");
        if(!Boolean.TRUE.equals(s.get("enabled"))||due.isAfter(now))return;
        // Missed days never create catch-up storms. Suspended/disabled scopes advance without execution.
        db.update("UPDATE briefing_daily_schedules SET next_due=? WHERE policy_id=?",time(nextDaily(now)),id);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id JOIN accounts a ON a.id=m.account_id WHERE t.id=? AND t.status='ACTIVE' AND m.account_id=? AND m.status='ACTIVE' AND a.status='ACTIVE')",Boolean.class,tenant,actor)))return;
        try{owner(actor,tenant);authority(actor,tenant,space);}catch(IdentityException e){return;}
        if(!Boolean.TRUE.equals(p.get("enabled"))||!due.atZone(DAILY_ZONE).toLocalDate().equals(now.atZone(DAILY_ZONE).toLocalDate()))return;
        var day=java.sql.Date.valueOf(now.atZone(DAILY_ZONE).toLocalDate());
        boolean retry=db.queryForObject("SELECT count(*) FROM briefing_daily_runs WHERE policy_id=? AND local_day=?",Integer.class,id,day)>0;
        if(retry&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_daily_retries r JOIN briefing_daily_runs original ON original.policy_id=r.policy_id AND original.local_day=r.local_day JOIN briefing_generation_batches b ON b.id=original.batch_id WHERE r.policy_id=? AND r.local_day=? AND r.batch_id IS NULL AND r.scheduled_for<=? AND b.status IN ('FAILED','CANCELLED','AUTHORITY_REVOKED'))",Boolean.class,id,day,time(now))))return;
        var active=db.queryForList("SELECT id FROM briefing_generation_batches WHERE policy_id=? AND business_type IS NULL AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') ORDER BY created_at LIMIT 1",UUID.class,id);
        UUID batch=active.isEmpty()?enqueue(id,"SCHEDULE",null,due):active.getFirst();
        if(retry)db.update("UPDATE briefing_daily_retries SET batch_id=? WHERE policy_id=? AND local_day=?",batch,id,day);
        else db.update("INSERT INTO briefing_daily_runs(policy_id,local_day,scheduled_for,batch_id) VALUES (?,?,?,?)",id,day,time(due),batch);
    }
    private Map<String,Object> selection(Source source,String contentKey){
        var result=new LinkedHashMap<String,Object>(source.selection());if(contentKey!=null)result.put("contentKey",contentKey);return result;
    }
    private boolean equivalentAutomaticAnalysis(UUID tenant,UUID actor,UUID id,String key,UUID space){
        return Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM briefing_generation_batches b
              WHERE b.tenant_id=? AND b.owner_id=? AND b.policy_id<>? AND b.source_key=?
                AND b.trigger_kind IN ('INITIALIZATION','DATA_READY','RESULT_READY','CONTEXT_CHANGED')
                AND coalesce(b.business_type,'AUTO')<>'INFO'
                AND (b.task_id IS NOT NULL OR b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')
                  AND NOT EXISTS(SELECT 1 FROM briefing_generation_batches own WHERE own.policy_id=?
                    AND own.task_id IS NULL AND own.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')
                    AND (own.created_at,own.id)<(b.created_at,b.id))))
            """,Boolean.class,tenant,actor,id,key,id));
    }
    private String governedContentKey(UUID actor,UUID tenant,Source source,com.dreamcore.workspace.governance.GovernanceModelService.AnalysisReadiness ready) {
        String content=sourceContentKey(actor,tenant,source);
        return ready==null||Set.of("DEPLOYMENT_SOURCE","LEGACY_GOVERNANCE").contains(ready.key()) ? content
            : IdentityService.hash(content+":"+ready.key());
    }
    private String sourceContentKey(UUID actor,UUID tenant,Source source){
        return source.dataset()?fingerprints.key(actor,tenant,source.materialId(),source.versionId()):IdentityService.hash(source.versionId().toString());
    }
    /** Called only by the host deployment service after its ordinary source authorization. */
    public void seedBootstrapBaseline(UUID policy,UUID batch,UUID dataset,UUID snapshot,boolean maintain){
        var row=db.queryForMap("SELECT d.name,d.workspace_id,d.dataset_key,s.collected_at FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id WHERE d.id=? AND s.id=?",dataset,snapshot);
        var source=new Source(dataset,snapshot,(String)row.get("name"),"READY",((Timestamp)row.get("collected_at")).toInstant(),"DATASET",(UUID)row.get("workspace_id"));
        var p=db.queryForMap("SELECT owner_id,tenant_id FROM briefing_generation_policies WHERE id=?",policy);
        var ready=governance.analysisReadiness((UUID)p.get("owner_id"),(UUID)p.get("tenant_id"),dataset,snapshot);
        db.update("UPDATE briefing_generation_batches SET source_versions=?::jsonb WHERE id=?",json.writeValueAsString(List.of(selection(source,governedContentKey((UUID)p.get("owner_id"),(UUID)p.get("tenant_id"),source,ready)))),batch);
        if(maintain){
            db.update("INSERT INTO briefing_bootstrap_scopes(policy_id,dataset_key) VALUES (?,?) ON CONFLICT DO NOTHING",policy,row.get("dataset_key"));
            db.update("UPDATE briefing_generation_policies SET enabled=true,reason='BOOTSTRAP_HANDOFF',revision=revision+1 WHERE id=?",policy);
        }
    }
    private boolean workbook(Source source){return source.filename().toLowerCase(Locale.ROOT).endsWith(".xlsx");}
    private String contextKey(UUID actor,UUID tenant,UUID space){
        var profiles=db.queryForList("SELECT v.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.kind IN ('GOAL','INFERENCE') AND (e.scope='TENANT' OR e.scope='WORKSPACE' AND e.workspace_id=? OR e.scope='PERSONAL' AND e.account_id=?) AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>?) ORDER BY e.id",UUID.class,tenant,space,actor,time(clock.now()));
        var insight=db.queryForList("SELECT t.id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN LATERAL ("+BriefingContentService.ELIGIBLE+") b ON true WHERE c.tenant_id=? AND c.owner_id=? AND c.workspace_id=? AND t.status='SUCCEEDED' AND convert_from(b.content,'UTF8')::jsonb->>'businessType'='INSIGHT' AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) ORDER BY t.finished_at DESC,t.id DESC LIMIT 1",UUID.class,tenant,actor,space);
        return IdentityService.hash(json.writeValueAsString(List.of(profiles,insight,workAudience.key(actor,tenant))));
    }
    private String recent(UUID actor,UUID tenant,UUID space){
        // The saved title carries the verified period; a bare total must not become "all history".
        String text=String.join("\n",db.queryForList("SELECT concat_ws(' — ',convert_from(b.content,'UTF8')::jsonb->>'title',convert_from(b.content,'UTF8')::jsonb->>'summary') FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN LATERAL ("+BriefingContentService.ELIGIBLE+") b ON true WHERE c.tenant_id=? AND c.owner_id=? AND c.workspace_id=? AND t.status='SUCCEEDED' AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) ORDER BY t.finished_at DESC,t.id DESC LIMIT 5",String.class,tenant,actor,space));
        return BriefingTaskPrompt.bounded(text,1000);
    }
    /** Settle already-finished work before the tenant status transition fences remaining attempts. */
    public void settleBeforeSuspension(UUID tenant){
        for(var b:db.queryForList("SELECT b.* FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND t.status NOT IN ('QUEUED','RUNNING') ORDER BY b.id",tenant))
            reconcile(db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",b.get("policy_id")),b);
    }
    private boolean emptyNewsSearch(UUID task,int attempt){
        return Boolean.TRUE.equals(db.queryForObject("""
            SELECT coalesce(web_sources,'[]'::jsonb)='[]'::jsonb
            AND (SELECT count(*) FROM briefing_news_search_queries q WHERE q.task_id=t.id) BETWEEN 2 AND 3
            AND (SELECT count(*) FROM conversation_tool_receipts r WHERE r.task_id=t.id AND r.attempt_number=? AND r.name='public_search' AND r.status='succeeded')=(SELECT count(*) FROM briefing_news_search_queries q WHERE q.task_id=t.id)
            AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=t.id AND r.attempt_number=? AND r.name='task_control' AND r.status='succeeded')
            AND NOT EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=t.id AND r.attempt_number=? AND (r.status<>'succeeded' OR r.name NOT IN ('activate_skill','public_search','task_control')))
            FROM conversation_tasks t WHERE t.id=?
            """,Boolean.class,attempt,attempt,attempt,task));
    }
    private void reconcile(Map<String,Object> p,Map<String,Object> b){
        UUID batch=(UUID)b.get("id"),task=(UUID)b.get("task_id"),tenant=(UUID)p.get("tenant_id");
        if(!p.get("epoch").equals(b.get("policy_epoch"))){tasks.interruptTasks(tenant,List.of(task),"BRIEFING_AUTHORITY_CHANGED");finish(batch,"AUTHORITY_REVOKED","AUTHORITY_CHANGED");return;}
        var t=db.queryForMap("SELECT status,attempt,error_code FROM conversation_tasks WHERE id=?",task);String status=(String)t.get("status");
        if(Set.of("QUEUED","RUNNING").contains(status))return;
        // A checked duplicate delivery is a completed empty batch even if earlier
        // recoverable tool calls left the task partial. Model prose is not evidence.
        if(status.equals("PARTIAL") && t.get("error_code")==null && Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM conversation_attempts a
              JOIN conversation_tasks t ON t.id=a.task_id
              JOIN identity_audit i ON i.target_id=a.attempt_id AND i.tenant_id=t.tenant_id AND i.actor_id=t.requested_by
              WHERE a.task_id=? AND a.attempt_number=? AND i.action='TASK_BRIEFING_DUPLICATE' AND i.outcome='SUCCESS'
              AND NOT t.reconciliation_required
              AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=a.task_id
                AND r.attempt_number=a.attempt_number AND r.name='deliver_briefing' AND r.status='succeeded'))
            """,Boolean.class,task,t.get("attempt")))) {
            finish(batch,"NO_NEW_CONTENT","DUPLICATE_CONTENT");
            if("INFO".equals(b.get("business_type")))db.update("UPDATE briefing_generation_policies SET info_day=? WHERE id=?",java.sql.Date.valueOf(clock.now().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()),p.get("id"));
            else db.update("UPDATE briefing_generation_policies SET data_key=?,context_key=? WHERE id=?",b.get("source_key"),b.get("context_key"),p.get("id"));
            return;
        }
        // A bounded news search with no readable article is a completed empty result, not a generation error.
        if(status.equals("PARTIAL")&&"INFO".equals(b.get("business_type"))&&emptyNewsSearch(task,(Integer)t.get("attempt"))){
            finish(batch,"NO_NEW_CONTENT","NEWS_NO_NEW_CONTENT");
            db.update("UPDATE briefing_generation_policies SET info_day=? WHERE id=?",java.sql.Date.valueOf(clock.now().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()),p.get("id"));return;
        }
        if(status.equals("SUCCEEDED")){
            boolean delivered=contents.find(task,(Integer)t.get("attempt"))!=null;finish(batch,delivered?"SUCCEEDED":"NO_NEW_CONTENT",delivered?null:"NO_NEW_CONTENT");
            if("INFO".equals(b.get("business_type")))db.update("UPDATE briefing_generation_policies SET info_day=? WHERE id=?",java.sql.Date.valueOf(clock.now().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()),p.get("id"));
            else db.update("UPDATE briefing_generation_policies SET data_key=?,context_key=? WHERE id=?",b.get("source_key"),b.get("context_key"),p.get("id"));
        }else{tasks.interruptTasks(tenant,List.of(task),"BRIEFING_TASK_UNFINISHED");finish(batch,status.equals("CANCELLED")?"CANCELLED":"FAILED",t.get("error_code")==null?"TASK_"+status:(String)t.get("error_code"));}
    }
}
