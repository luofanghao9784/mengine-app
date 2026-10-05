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
    public record Source(UUID materialId,UUID versionId,String filename,String parseStatus,Instant changedAt,String kind) {
        Source(UUID id,UUID version,String name,String status,Instant changed){this(id,version,name,status,changed,"MATERIAL");}
        boolean dataset(){return "DATASET".equals(kind);}
        Map<String,Object> selection(){return dataset()?Map.of("kind","DATASET","datasetId",materialId,"snapshotId",versionId):Map.of("materialId",materialId,"versionId",versionId);}
    }
    public record Batch(UUID id,UUID workspaceId,String trigger,String businessType,String status,String reason,UUID taskId,List<UUID> cardIds,Instant createdAt,Instant finishedAt) {}
    public record Policy(UUID id,UUID workspaceId,String workspaceName,boolean enabled,int revision,String reason) {}
    public record State(List<Policy> policies,List<Batch> batches) {}
    private static final Set<String> TYPES=Set.of("INFO","DATA","INSIGHT","SUGGESTION","RESULT");
    private static final Set<String> OPEN=Set.of("QUEUED","RUNNING","WAITING_DATA","WAITING_RESOURCE","WAITING_CAPABILITY");
    private final JdbcTemplate db;private final ConversationService tasks;private final BriefingContentService contents;
    private final IdentityService identities;private final MaterialAccess access;private final DepartureAccess departure;
    private final AgentSettings agents;private final PlanClock clock;private final JsonMapper json=new JsonMapper();
    private final boolean tasksEnabled;private final String newsSource;private final int mergeSeconds,dailyLimit;
    @Value("${dreamcore.briefing.automatic-enabled:true}") private boolean automaticEnabled=true;
    public BriefingGenerationService(JdbcTemplate db,ConversationService tasks,BriefingContentService contents,IdentityService identities,MaterialAccess access,DepartureAccess departure,AgentSettings agents,PlanClock clock,
        @Value("${dreamcore.tasks.enabled:false}") boolean tasksEnabled,@Value("${dreamcore.briefing.news-source:}") String newsSource,
        @Value("${dreamcore.briefing.merge-seconds:60}") int mergeSeconds,@Value("${dreamcore.briefing.max-runs-per-day:6}") int dailyLimit){
        this.db=db;this.tasks=tasks;this.contents=contents;this.identities=identities;this.access=access;this.departure=departure;this.agents=agents;this.clock=clock;this.tasksEnabled=tasksEnabled;this.newsSource=validateNewsSource(newsSource);this.mergeSeconds=Math.max(0,mergeSeconds);this.dailyLimit=Math.max(1,Math.min(24,dailyLimit));
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
    private UUID chooseSpace(UUID actor,UUID tenant,UUID requested){
        if(requested!=null){authority(actor,tenant,requested);return requested;}
        var spaces=db.queryForList("""
          SELECT w.id FROM workspaces w WHERE w.tenant_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR EXISTS(
          SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=?))
          ORDER BY (EXISTS(SELECT 1 FROM active_materials m WHERE m.workspace_id=w.id AND m.in_library) OR EXISTS(SELECT 1 FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE d.workspace_id=w.id AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed)) DESC,w.kind='PERSONAL' DESC,w.id LIMIT 1
          """,UUID.class,tenant,actor,actor);
        if(spaces.isEmpty())throw new IdentityException(409,"BRIEFING_WORKSPACE_REQUIRED");
        authority(actor,tenant,spaces.getFirst());return spaces.getFirst();
    }
    @Transactional public Batch generate(UUID actor,UUID tenant,UUID request,UUID space,String type){
        authority(actor,tenant,null);if(request==null||type!=null&&!TYPES.contains(type))throw IdentityException.invalid();lock(actor,tenant);
        String fingerprint=IdentityService.hash(tenant+":"+space+":"+type);
        var prior=db.queryForList("SELECT batch_id,fingerprint FROM briefing_generation_requests WHERE tenant_id=? AND owner_id=? AND request_id=?",tenant,actor,request);
        if(!prior.isEmpty()){if(!prior.getFirst().get("fingerprint").equals(fingerprint))throw new IdentityException(409,"BRIEFING_REQUEST_CONFLICT");return get(actor,tenant,(UUID)prior.getFirst().get("batch_id"));}
        UUID chosen=chooseSpace(actor,tenant,space),p=policy(actor,tenant,chosen);
        var active=db.queryForList("SELECT id FROM briefing_generation_batches WHERE tenant_id=? AND owner_id=? AND workspace_id=? AND coalesce(business_type,'AUTO')=coalesce(?,'AUTO') AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') ORDER BY created_at LIMIT 1",UUID.class,tenant,actor,chosen,type);
        UUID id=active.isEmpty()?enqueue(p,"GENERATE_MORE",type,null):active.getFirst();
        db.update("INSERT INTO briefing_generation_requests VALUES(?,?,?,?,?)",tenant,actor,request,fingerprint,id);
        return get(actor,tenant,id);
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
        batches.sort(Comparator.comparing(Batch::createdAt).reversed());return new State(policies,batches.stream().limit(20).toList());
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
        var b=get(actor,tenant,id);lock(actor,tenant);if(OPEN.contains(b.status())){
            if(b.taskId()!=null)tasks.interruptTasks(tenant,List.of(b.taskId()),"BRIEFING_CANCELLED");
            finish(id,"CANCELLED","USER_CANCELLED");
        }return get(actor,tenant,id);
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
    public List<UUID> candidates(){return db.queryForList("SELECT id FROM briefing_generation_policies WHERE (? AND enabled) OR EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.policy_id=briefing_generation_policies.id AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND (? OR b.trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_generation_requests request WHERE request.batch_id=b.id))) ORDER BY checked_at NULLS FIRST,id LIMIT 20",UUID.class,automaticEnabled,automaticEnabled);}
    private List<Source> sources(UUID tenant,UUID space){var sources=new ArrayList<>(db.query("""
        SELECT m.id,v.id version_id,v.filename,v.created_at,coalesce(k.status,'NOT_REQUESTED') parse_status FROM active_materials m
        JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
        LEFT JOIN LATERAL(SELECT status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) k ON true
        WHERE m.tenant_id=? AND m.workspace_id=? AND m.in_library ORDER BY m.id LIMIT 1001
        """,(r,n)->new Source(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),r.getString("parse_status"),r.getTimestamp("created_at").toInstant()),tenant,space));
        sources.addAll(db.query("""
          SELECT d.id,s.id snapshot_id,d.name,s.collected_at FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot
          WHERE d.tenant_id=? AND d.workspace_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed ORDER BY d.id LIMIT 1001
          """,(r,n)->new Source(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),"READY",r.getTimestamp(4).toInstant(),"DATASET"),tenant,space));
        return sources.stream().sorted(Comparator.comparing(Source::kind).thenComparing(Source::materialId)).limit(1001).toList();
    }
    private String fingerprint(List<Source> sources){return IdentityService.hash(json.writeValueAsString(sources.stream().map(s->List.of(s.kind(),s.materialId(),s.versionId())).toList()));}
    private void waiting(UUID batch,String status,String reason){db.update("UPDATE briefing_generation_batches SET status=?,reason=? WHERE id=?",status,reason,batch);}
    private void finish(UUID batch,String status,String reason){db.update("UPDATE briefing_generation_batches SET status=?,reason=?,finished_at=? WHERE id=?",status,reason,time(clock.now()),batch);}
    @Transactional public void tick(UUID id){
        var rows=db.queryForList("SELECT * FROM briefing_generation_policies WHERE id=?",id);if(rows.isEmpty())return;var p=rows.getFirst();
        UUID tenant=(UUID)p.get("tenant_id"),actor=(UUID)p.get("owner_id"),space=(UUID)p.get("workspace_id");lock(actor,tenant);
        p=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=? FOR UPDATE",id);Instant now=clock.now();
        db.update("UPDATE briefing_generation_policies SET checked_at=? WHERE id=?",time(now),id);
        if("SUSPENDED".equals(db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant))){db.update("UPDATE briefing_generation_policies SET reason='TENANT_SERVICE_SUSPENDED' WHERE id=?",id);return;}
        var active=db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND (? OR trigger_kind='GENERATE_MORE' OR EXISTS(SELECT 1 FROM briefing_generation_requests request WHERE request.batch_id=briefing_generation_batches.id)) AND NOT (coalesce(business_type,'AUTO')='INFO' AND status='WAITING_DATA' AND reason='NEWS_SOURCE_UNAVAILABLE' AND ?) ORDER BY created_at LIMIT 1 FOR UPDATE",id,automaticEnabled,newsSource.isBlank()||!agents.publicWebEnabled());
        try{authority(actor,tenant,space);}catch(IdentityException e){
            for(var b:active){if(b.get("task_id")!=null)tasks.interruptTasks(tenant,List.of((UUID)b.get("task_id")),"BRIEFING_AUTHORITY_REVOKED");finish((UUID)b.get("id"),"AUTHORITY_REVOKED","AUTHORITY_REVOKED");}
            db.update("UPDATE briefing_generation_policies SET reason='AUTHORITY_REVOKED' WHERE id=?",id);return;
        }
        if(!active.isEmpty()&&active.getFirst().get("task_id")!=null){
            reconcile(p,active.getFirst());return;
        }
        List<Source> sources=sources(tenant,space);String contextKey=contextKey(actor,tenant,space);
        String key=IdentityService.hash(fingerprint(sources)+contextKey);
        Set<String> seen=new HashSet<>(db.queryForList("SELECT coalesce(v->>'snapshotId',v->>'versionId') FROM briefing_generation_batches b CROSS JOIN LATERAL jsonb_array_elements(b.source_versions) v WHERE b.policy_id=? AND b.status IN ('SUCCEEDED','NO_NEW_CONTENT') AND coalesce(b.business_type,'AUTO')<>'INFO'",String.class,id));
        Instant resumed=db.queryForObject("SELECT service_resumed_at FROM tenants WHERE id=?",(r,n)->r.getTimestamp(1)==null?null:r.getTimestamp(1).toInstant(),tenant);
        var unseen=sources.stream().filter(source->!seen.contains(source.versionId().toString()) && (resumed==null||source.changedAt().isAfter(resumed))).toList();
        if(Boolean.TRUE.equals(p.get("service_resume_pending"))){
            db.update("UPDATE briefing_generation_policies SET context_key=?,service_resume_pending=false WHERE id=?",contextKey,id);
            p.put("context_key",contextKey);
        }
        if(active.isEmpty()){
            if(!automaticEnabled||!Boolean.TRUE.equals(p.get("enabled")))return;
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
            if(changed&&!failedSame){
                boolean result=unseen.stream().anyMatch(source->!source.dataset()&&completedPublication(source.versionId()));
                enqueue(id,p.get("data_key")==null?"INITIALIZATION":goalChanged?"CONTEXT_CHANGED":result?"RESULT_READY":"DATA_READY",goalChanged?"SUGGESTION":result?"RESULT":null,null);
            }
            else if(!sources.isEmpty()&&!newsSource.isBlank()&&agents.publicWebEnabled()&&(now.atZone(ZoneId.of("Asia/Shanghai")).getHour()>=9) && (p.get("info_day")==null||!((java.sql.Date)p.get("info_day")).toLocalDate().equals(now.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()))){
                var date=now.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate();
                boolean exists=db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE policy_id=? AND business_type='INFO' AND scheduled_for=?)",Boolean.class,id,time(date.atTime(9,0).atZone(ZoneId.of("Asia/Shanghai")).toInstant()));
                if(exists)return;enqueue(id,p.get("info_day")==null?"INITIALIZATION":"SCHEDULE","INFO",date.atTime(9,0).atZone(ZoneId.of("Asia/Shanghai")).toInstant());
            }else{db.update("UPDATE briefing_generation_policies SET reason=? WHERE id=?",sources.isEmpty()?"WAITING_DATA":newsSource.isBlank()||!agents.publicWebEnabled()?"NEWS_SOURCE_UNAVAILABLE":"NO_NEW_VERSION",id);return;}
            active=db.queryForList("SELECT * FROM briefing_generation_batches WHERE policy_id=? AND status='QUEUED' ORDER BY created_at DESC LIMIT 1",id);
        }
        var b=active.getFirst();UUID batch=(UUID)b.get("id");String type=(String)b.get("business_type");boolean info="INFO".equals(type);
        if(!p.get("epoch").equals(b.get("policy_epoch"))){finish(batch,"AUTHORITY_REVOKED","AUTHORITY_CHANGED");return;}
        if(info&&(newsSource.isBlank()||!agents.publicWebEnabled())){waiting(batch,"WAITING_DATA","NEWS_SOURCE_UNAVAILABLE");return;}
        if(sources.isEmpty()&&info){waiting(batch,"WAITING_DATA","NEWS_CONTEXT_UNAVAILABLE");return;}
        {
            if(sources.isEmpty()){waiting(batch,"WAITING_DATA","NO_MATERIALS");return;}
            if(sources.size()>1000){waiting(batch,"WAITING_RESOURCE","SOURCE_COUNT_LIMIT");return;}
            if(sources.stream().anyMatch(s->!Set.of("READY","PARTIAL").contains(s.parseStatus()))){waiting(batch,"WAITING_DATA","MATERIALS_NOT_READY");return;}
            if(sources.stream().anyMatch(s->s.changedAt().plusSeconds(mergeSeconds).isAfter(now))){waiting(batch,"WAITING_DATA","MERGING_DATA_EVENTS");return;}
        }
        if(!tasksEnabled||!agents.enabled()){waiting(batch,"WAITING_CAPABILITY","MODEL_NOT_CONFIGURED");return;}
        Instant day=now.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
        // The latest reset within this UTC day starts a new owner budget without rewriting history.
        Instant ownerSince=db.queryForObject("SELECT coalesce(max(reset_at),?) FROM briefing_quota_resets WHERE tenant_id=? AND owner_id=? AND reset_at>=? AND reset_at<=?",Timestamp.class,time(day),tenant,actor,time(day),time(now)).toInstant();
        int used=db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND owner_id=? AND task_id IS NOT NULL AND started_at>=?",Integer.class,tenant,actor,time(ownerSince));
        int concurrent=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.owner_id=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,tenant,actor);
        int tenantUsed=db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND started_at>=?",Integer.class,tenant,time(day));
        int tenantConcurrent=db.queryForObject("SELECT count(*) FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,tenant);
        if(used>=dailyLimit||concurrent>=1||tenantUsed>=48||tenantConcurrent>=2){waiting(batch,"WAITING_RESOURCE",used>=dailyLimit?"DAILY_RUN_LIMIT":tenantUsed>=48?"TENANT_DAILY_LIMIT":tenantConcurrent>=2?"TENANT_CONCURRENCY_LIMIT":"OWNER_CONCURRENCY_LIMIT");return;}
        // One complete topic per batch. Explicit bounded source selection is visible to the model and reader.
        var order=Comparator.comparing(Source::changedAt,Comparator.reverseOrder()).thenComparing(Source::filename);
        List<Source> selected=(info||unseen.isEmpty()?sources:unseen).stream().filter(s->!"RESULT".equals(type)||!s.dataset()&&completedPublication(s.versionId())).sorted(order).limit(3).toList();
        // An unchanged current workbook can ground a new topic; consumption is not a ban on reuse.
        // Keep two unseen documents, the same authorized workspace and the three-version bound.
        if((type==null||"DATA".equals(type))&&selected.stream().noneMatch(this::workbook)){
            var reference=sources.stream().filter(this::workbook).sorted(order).findFirst();
            if(reference.isPresent()){
                var grounded=new ArrayList<Source>();grounded.add(reference.get());grounded.addAll(selected.stream().limit(2).toList());selected=List.copyOf(grounded);
            }
        }
        if(selected.isEmpty()){waiting(batch,"WAITING_DATA","RESULT_NOT_READY");return;}
        String previous=recent(actor,tenant,space);String prompt="系统智能画报生成。触发："+b.get("trigger_kind")+"。本批最多生成一张有独立价值的新卡。类型："+(type==null?"按证据选择 DATA、INSIGHT、SUGGESTION 或 RESULT":type)+"。"+
            (info?"先用 task_context profiles 读取当前企业和工作空间背景，再读取所选授权资料，分析当前企业主营业务、工作空间或项目目标和近期关注点，再从获准公开资讯源筛选与这些上下文有直接关系的资讯。卡片必须说明资讯与企业或项目的关联及价值，并标注原文网址、发布时间和检索时间。缺日期应明确未核实，不把旧文当今天新闻。没有相关资讯就说明暂无新内容。外部请求只允许配置的公开来源，不能把内部资料、人员或经营数值发送到公开搜索。": "仅根据本次固定的所选资料版本分析，不代表全部企业资料；部分解析时明确资料缺口，不能声称完整统计。选取范围："+selected.stream().map(Source::filename).toList()+"。")+
            "本批固定来源类型："+selected.stream().map(s->s.kind()+":"+s.filename()).toList()+"。文件调用 search_sources 空查询；数据集调用 task_context dataset_search 查询后，用 dataset_read 查看实际列与期间。最多两次针对性检索，选择一个资料完整的主题。所选当前底表可作为新主题的参考，重复使用不代表数据更新，保留原统计期间。工具调用前不要输出分析草稿，正文只在 deliver_briefing 中给出。计算参数只使用已返回的表头、单元格范围和来源 ID，不猜测参数。若是 CONTEXT_CHANGED 触发，先用 task_context profiles 读取当前企业、工作空间和个人的目标或洞察，区分已确认事实与推断。DATA 根据来源调用 compare_table 或 compare_dataset；数据库必须计算完整固定快照，不从分页样本推算汇总，图表数值不可自行填写，其他类型无需调用表格工具。使用 deliver_briefing 交付。缺证据或与已有内容重复时直接说明暂无新内容，不凑卡。区分事实和推断，保留数据统计期间。已有内容仅用于避免重复，不作为新事实：\n"+previous;
        if(prompt.length()>2000)prompt=prompt.substring(0,2000);
        var detail=tasks.submitBriefing(actor,tenant,space,batch,prompt,info?newsSource:null,selected.stream().filter(s->!s.dataset()).map(s->new TaskOriginals.Selection(s.materialId(),s.versionId())).toList());
        UUID task=detail.tasks().getLast().id();
        db.update("UPDATE briefing_generation_batches SET task_id=?,status='RUNNING',reason=NULL,source_key=?,context_key=?,source_versions=?::jsonb,started_at=? WHERE id=?",task,key,contextKey,json.writeValueAsString(selected.stream().map(Source::selection).toList()),time(now),batch);
        for(var source:selected)if(source.dataset())db.update("INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id) VALUES (?,?,?,?)",task,batch,source.materialId(),source.versionId());
        db.update("UPDATE briefing_generation_policies SET reason=NULL WHERE id=?",id);
    }
    private boolean workbook(Source source){return source.filename().toLowerCase(Locale.ROOT).endsWith(".xlsx");}
    private String contextKey(UUID actor,UUID tenant,UUID space){
        var profiles=db.queryForList("SELECT v.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.kind IN ('GOAL','INFERENCE') AND (e.scope='TENANT' OR e.scope='WORKSPACE' AND e.workspace_id=? OR e.scope='PERSONAL' AND e.account_id=?) AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>?) ORDER BY e.id",UUID.class,tenant,space,actor,time(clock.now()));
        var insight=db.queryForList("SELECT t.id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN LATERAL ("+BriefingContentService.ELIGIBLE+") b ON true WHERE c.tenant_id=? AND c.owner_id=? AND c.workspace_id=? AND t.status='SUCCEEDED' AND convert_from(b.content,'UTF8')::jsonb->>'businessType'='INSIGHT' AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) ORDER BY t.finished_at DESC,t.id DESC LIMIT 1",UUID.class,tenant,actor,space);
        return IdentityService.hash(json.writeValueAsString(List.of(profiles,insight)));
    }
    private String recent(UUID actor,UUID tenant,UUID space){
        String text=String.join("\n",db.queryForList("SELECT convert_from(b.content,'UTF8')::jsonb->>'summary' FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN LATERAL ("+BriefingContentService.ELIGIBLE+") b ON true WHERE c.tenant_id=? AND c.owner_id=? AND c.workspace_id=? AND t.status='SUCCEEDED' AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id) ORDER BY t.finished_at DESC LIMIT 5",String.class,tenant,actor,space));
        return text.substring(0,Math.min(1000,text.length()));
    }
    /** Settle already-finished work before the tenant status transition fences remaining attempts. */
    public void settleBeforeSuspension(UUID tenant){
        for(var b:db.queryForList("SELECT b.* FROM briefing_generation_batches b JOIN conversation_tasks t ON t.id=b.task_id WHERE b.tenant_id=? AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY') AND t.status NOT IN ('QUEUED','RUNNING') ORDER BY b.id",tenant))
            reconcile(db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",b.get("policy_id")),b);
    }
    private void reconcile(Map<String,Object> p,Map<String,Object> b){
        UUID batch=(UUID)b.get("id"),task=(UUID)b.get("task_id"),tenant=(UUID)p.get("tenant_id");
        if(!p.get("epoch").equals(b.get("policy_epoch"))){tasks.interruptTasks(tenant,List.of(task),"BRIEFING_AUTHORITY_CHANGED");finish(batch,"AUTHORITY_REVOKED","AUTHORITY_CHANGED");return;}
        var t=db.queryForMap("SELECT status,attempt,error_code FROM conversation_tasks WHERE id=?",task);String status=(String)t.get("status");
        if(Set.of("QUEUED","RUNNING").contains(status))return;
        if(status.equals("SUCCEEDED")){
            boolean delivered=contents.find(task,(Integer)t.get("attempt"))!=null;finish(batch,delivered?"SUCCEEDED":"NO_NEW_CONTENT",delivered?null:"NO_NEW_CONTENT");
            if("INFO".equals(b.get("business_type")))db.update("UPDATE briefing_generation_policies SET info_day=? WHERE id=?",java.sql.Date.valueOf(clock.now().atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()),p.get("id"));
            else db.update("UPDATE briefing_generation_policies SET data_key=?,context_key=? WHERE id=?",b.get("source_key"),b.get("context_key"),p.get("id"));
        }else{tasks.interruptTasks(tenant,List.of(task),"BRIEFING_TASK_UNFINISHED");finish(batch,status.equals("CANCELLED")?"CANCELLED":"FAILED",t.get("error_code")==null?"TASK_"+status:(String)t.get("error_code"));}
    }
}
