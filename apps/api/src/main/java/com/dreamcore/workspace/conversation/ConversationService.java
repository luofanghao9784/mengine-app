package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.plans.PlanTaskGate;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.*;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service
public class ConversationService {
    public record Conversation(UUID id,UUID tenantId,UUID workspaceId,String title,Instant updatedAt,int managementRevision,boolean running,boolean unread,long replyRevision,UUID latestReplyTaskId,Instant trashedAt,boolean briefingDiscussion) {
        public Conversation(UUID id,UUID tenantId,UUID workspaceId,String title,Instant updatedAt){this(id,tenantId,workspaceId,title,updatedAt,0,false,false,0,null,null,false);}
    }
    public record Page(UUID tenantId,boolean enabled,List<Conversation> items,boolean hasMore,String agentMode,boolean publicWebEnabled) {}
    public record Artifact(UUID id,String filename,String sha256,int bytes) {}
    public record Task(UUID id,String prompt,String mode,String status,int revision,int attempt,String summaryCode,String errorCode,String engineVersion,boolean sourcesUnavailable,List<KnowledgeService.Chunk> sources,Instant createdAt,String reply,String executionClass,String modelName,List<Artifact> artifacts,String publicQuery,List<AgentResult.WebSource> webSources,List<AgentResult.Skill> skills,List<TaskOriginals.File> originals,String waitReason,String requiredInput,boolean reconciliationRequired,String supplementalInput) {}
    public record Attempt(int number,String status,String input,String reply,String summaryCode,String errorCode,String engineVersion,String modelName,List<AgentResult.Tool> tools,List<KnowledgeService.Chunk> sources,List<Artifact> artifacts,Instant startedAt,Instant finishedAt,String provenance,String reconciliationCode) {}
    public record Attempts(UUID taskId,List<Attempt> items,boolean hasMore) {}
    public record BriefingReference(UUID conversationId,UUID taskId,UUID workspaceId,int taskRevision,int attempt) {}
    public record Detail(Conversation conversation,List<Task> tasks,boolean hasMore,long cursor,BriefingReference briefingContext) {}
    public record Event(long seq,UUID taskId,String kind,int revision) {}
    public record Events(UUID conversationId,List<Event> items,long cursor,boolean hasMore) {}
    public record Job(UUID id,UUID tenant,UUID space,UUID conversation,UUID actor,String prompt,UUID token,String mode) {}
    private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
    private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final KnowledgeService knowledge;private final IdentityAudit audit;private final boolean enabled;private final AgentSettings agentSettings;private final TaskOriginals originals;private final AgentUsageLedger usage;private final PlanTaskGate planGate;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public ConversationService(JdbcTemplate db,IdentityService identities,MaterialAccess access,KnowledgeService knowledge,IdentityAudit audit,@Value("${dreamcore.tasks.enabled:false}") boolean enabled,AgentSettings agentSettings,TaskOriginals originals,AgentUsageLedger usage,PlanTaskGate planGate,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;this.planGate=planGate;this.usage=usage;this.originals=originals;this.agentSettings=agentSettings;this.db=db;this.identities=identities;this.access=access;this.knowledge=knowledge;this.audit=audit;this.enabled=enabled;}
    static final String RUNNING_SQL="EXISTS(SELECT 1 FROM conversation_tasks active WHERE active.conversation_id=c.id AND active.origin='USER' AND active.status IN ('QUEUED','RUNNING') AND object_is_active('TASK',active.id)) AS running";
    static final String BRIEFING_DISCUSSION_SQL="EXISTS(SELECT 1 FROM briefing_discussions d WHERE d.conversation_id=c.id) AS briefing_discussion";
    private final RowMapper<Conversation> mapper=(r,n)->{
        UUID id=r.getObject("id",UUID.class);String title=readableTitle(id,r.getString("title"));
        boolean readable=!title.equals("会话内容暂不可用");
        return new Conversation(id,r.getObject("tenant_id",UUID.class),r.getObject("workspace_id",UUID.class),title,r.getTimestamp("updated_at").toInstant(),r.getInt("management_revision"),readable&&r.getBoolean("running"),readable&&r.getLong("reply_revision")>r.getLong("read_reply_revision"),r.getLong("reply_revision"),r.getObject("latest_reply_task_id",UUID.class),r.getTimestamp("trashed_at")==null?null:r.getTimestamp("trashed_at").toInstant(),readable&&r.getBoolean("briefing_discussion"));
    };
    // Both fallback and generated metadata retain their source task authority.
    private String readableTitle(UUID conversation,String title){
        if(!discussionReadable(conversation))return "会话内容暂不可用";
        var titleSources=db.queryForList("SELECT source_task_id FROM conversation_titles WHERE conversation_id=? AND state='GENERATED'",UUID.class,conversation);
        if(!titleSources.isEmpty() && !sourcesReadable(titleSources.getFirst()))return "会话内容暂不可用";
        var first=db.queryForList("SELECT t.id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.conversation_id=? AND (c.purpose<>'BUSINESS' OR t.origin='USER') ORDER BY t.created_at,t.id LIMIT 1",UUID.class,conversation);
        return first.isEmpty() || sourcesReadable(first.getFirst())?title:"会话内容暂不可用";
    }
    private void paging(int offset,int limit){if(offset<0 || offset>100000 || limit<1 || limit>50)throw IdentityException.invalid();}
    @Transactional public boolean hasUnreadOrAttention(UUID actor,UUID tenant) {
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var ids=db.queryForList("""
          SELECT c.id FROM conversations c JOIN workspaces w ON w.id=c.workspace_id AND w.tenant_id=c.tenant_id
          LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=?
          WHERE c.tenant_id=? AND c.owner_id=? AND c.purpose='BUSINESS' AND c.trashed_at IS NULL
          AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
          AND ((c.reply_revision>c.read_reply_revision AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=c.latest_reply_task_id))
            OR EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.origin='USER'
              AND t.status IN ('WAITING_INPUT','RESULT_UNKNOWN')
              AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id)))
          """,UUID.class,actor,tenant,actor,actor);
        return ids.stream().anyMatch(this::discussionReadable);
    }
    Conversation require(UUID actor,UUID tenant,UUID id,boolean lock) {
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var rows=db.query("SELECT c.*,"+RUNNING_SQL+","+BRIEFING_DISCUSSION_SQL+" FROM conversations c WHERE tenant_id=? AND owner_id=? AND id=? AND trashed_at IS NULL"+(lock?" FOR NO KEY UPDATE":""),mapper,tenant,actor,id);
        if(rows.isEmpty())throw new IdentityException(404,"CONVERSATION_NOT_FOUND");
        if(!discussionReadable(id))throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");
        var conversation=rows.getFirst();access.require(actor,tenant,conversation.workspaceId(),false);return conversation;
    }
    public BriefingReference briefingReference(UUID conversation){
        var rows=db.query("SELECT s.conversation_id,s.id,s.workspace_id,d.source_revision,d.source_attempt FROM briefing_discussions d JOIN conversation_tasks s ON s.id=d.source_task_id WHERE d.conversation_id=?",(r,n)->new BriefingReference(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),r.getInt(4),r.getInt(5)),conversation);
        return rows.isEmpty()?null:rows.getFirst();
    }
    boolean discussionReadable(UUID conversation){
        return !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_discussions d JOIN conversation_tasks s ON s.id=d.source_task_id WHERE d.conversation_id=? AND (s.revision<>d.source_revision OR s.attempt<>d.source_attempt OR s.status<>'SUCCEEDED' OR NOT EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=s.id)))",Boolean.class,conversation));
    }
    boolean sourcesReadable(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,task));}
    void requireReadable(UUID task){if(!sourcesReadable(task))throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");}
    void event(UUID tenant,UUID space,UUID conversation,UUID task,String kind,int revision) {
        db.update("INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision) VALUES (?,?,?,?,?,?)",tenant,space,conversation,task,kind,revision);
    }
    @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit) {
        return list(actor,tenant,offset,limit,false);
    }
    @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit,boolean trash) {
        paging(offset,limit);identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var found=db.query("""
          SELECT c.*, %s, %s FROM conversations c JOIN workspaces w ON w.tenant_id=c.tenant_id AND w.id=c.workspace_id
          LEFT JOIN workspace_members g ON g.tenant_id=c.tenant_id AND g.workspace_id=c.workspace_id AND g.account_id=?
          WHERE c.tenant_id=? AND c.owner_id=? AND (c.trashed_at IS NOT NULL)=? AND c.purpose='BUSINESS' AND EXISTS(SELECT 1 FROM conversation_tasks user_task WHERE user_task.conversation_id=c.id AND user_task.origin='USER') AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
          ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?
          """.formatted(RUNNING_SQL,BRIEFING_DISCUSSION_SQL),mapper,actor,tenant,actor,trash,actor,limit+1,offset);
        return new Page(tenant,enabled,found.stream().limit(limit).toList(),found.size()>limit,agentSettings.mode(),agentSettings.publicWebEnabled());
    }
    @Transactional public Detail detail(UUID actor,UUID tenant,UUID id,int offset,int limit) {
        return detailInternal(actor,tenant,id,offset,limit,false);
    }
    private Detail detailInternal(UUID actor,UUID tenant,UUID id,int offset,int limit,boolean internal) {
        paging(offset,limit);
        // Snapshot the cursor before reading title/content so a concurrent metadata commit is never acknowledged unseen.
        long cursor=db.queryForObject("SELECT coalesce(max(seq),0) FROM conversation_events WHERE conversation_id=?",Long.class,id);
        var conversation=require(actor,tenant,id,false);
        var tasks=db.query("SELECT * FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND (origin='USER' OR ?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",(r,n)->{
            UUID task=r.getObject("id",UUID.class);
            if(!sourcesReadable(task))return new Task(task,"任务内容或来源当前不可用",r.getString("mode"),r.getString("status"),r.getInt("revision"),r.getInt("attempt"),null,"TASK_SOURCE_UNAVAILABLE",r.getString("engine_version"),true,List.of(),r.getTimestamp("created_at").toInstant(),null,r.getString("execution_class"),r.getString("model_name"),List.of(),null,List.of(),List.of(),List.of(),null,null,r.getBoolean("reconciliation_required"),null);
            var sources=new ArrayList<KnowledgeService.Chunk>();boolean unavailable=false;
            var ids=db.queryForList("SELECT chunk_id FROM conversation_sources WHERE tenant_id=? AND workspace_id=? AND task_id=? AND attempt_number=? ORDER BY ordinal",UUID.class,tenant,conversation.workspaceId(),task,r.getInt("attempt"));
            for(UUID chunk:ids)sources.add(knowledge.citation(actor,tenant,chunk));
            return new Task(task,r.getString("prompt"),r.getString("mode"),r.getString("status"),r.getInt("revision"),r.getInt("attempt"),unavailable?null:r.getString("summary_code"),r.getString("error_code"),r.getString("engine_version"),unavailable,sources,r.getTimestamp("created_at").toInstant(),r.getString("reply"),r.getString("execution_class"),r.getString("model_name"),db.query("SELECT id,filename,sha256,octet_length(content) FROM conversation_artifacts WHERE task_id=? AND attempt_number=? AND object_is_active('ARTIFACT',id) ORDER BY filename,id",(a,i)->new Artifact(a.getObject(1,UUID.class),a.getString(2),a.getString(3),a.getInt(4)),task,r.getInt("attempt")),r.getString("public_query"),Arrays.asList(json.readValue(r.getString("web_sources"),AgentResult.WebSource[].class)),Arrays.asList(json.readValue(r.getString("skills"),AgentResult.Skill[].class)),originals.list(actor,tenant,conversation.workspaceId(),task),r.getString("wait_reason"),r.getString("required_input"),r.getBoolean("reconciliation_required"),r.getString("supplemental_input"));
        },tenant,id,internal,limit+1,offset);
        var visible=new ArrayList<>(tasks.stream().limit(limit).toList());Collections.reverse(visible);return new Detail(conversation,visible,tasks.size()>limit,cursor,briefingReference(id));
    }
    @Transactional public Detail taskDetail(UUID actor,UUID tenant,UUID conversation,UUID task) {
        require(actor,tenant,conversation,true);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND id=?)",Boolean.class,tenant,conversation,task)))throw new IdentityException(404,"TASK_NOT_FOUND");
        int offset=db.queryForObject("SELECT count(*) FROM conversation_tasks t JOIN conversation_tasks anchor ON anchor.id=? WHERE t.conversation_id=? AND (t.created_at,t.id)>(anchor.created_at,anchor.id)",Integer.class,task,conversation);
        return detailInternal(actor,tenant,conversation,offset,1,true);
    }
    @Transactional public Detail historical(UUID actor,UUID tenant,UUID conversation,UUID task) {
        require(actor,tenant,conversation,true);
        var row=db.queryForList("SELECT id FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND id=? AND mode='AGENT' AND status='SUCCEEDED'",UUID.class,tenant,conversation,task);
        if(row.isEmpty())throw new IdentityException(404,"TASK_NOT_FOUND");
        requireReadable(task);
        int offset=db.queryForObject("SELECT count(*) FROM conversation_tasks t JOIN conversation_tasks anchor ON anchor.id=? WHERE t.conversation_id=? AND (t.created_at,t.id)>(anchor.created_at,anchor.id)",Integer.class,task,conversation);
        return detailInternal(actor,tenant,conversation,offset,1,true);
    }
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode){return submit(actor,tenant,id,space,key,prompt,mode,null);}
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery) {return submit(actor,tenant,id,space,key,prompt,mode,publicQuery,List.of());}
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery,List<TaskOriginals.Selection> selectedOriginals) {
        return submitInternal(actor,tenant,id,space,key,prompt,mode,publicQuery,selectedOriginals,false,"WORKSPACE",false);
    }
    /** New interactive tasks opt into the authorized library; delegated/legacy calls retain WORKSPACE. */
    @Transactional public Detail submitClient(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery,List<TaskOriginals.Selection> selected,String sourceScope){
        String scope=sourceScope==null?"AUTHORIZED_LIBRARY":sourceScope;
        if(!Set.of("AUTHORIZED_LIBRARY","SELECTED").contains(scope))throw IdentityException.invalid();
        if(prompt!=null && prompt.matches("(?s).*(只|仅)(使用|用|依据|根据|基于|参考).{0,12}(所选|附件|上传|这[几些份个]*资料|这[几些份个]*文件).*"))scope="SELECTED";
        if(scope.equals("SELECTED")&&(selected==null||selected.isEmpty()))throw new IdentityException(400,"TASK_SELECTION_REQUIRED");
        if(scope.equals("SELECTED")&&publicQuery!=null&&!publicQuery.isBlank())throw new IdentityException(400,"TASK_SCOPE_CONFLICT");
        return submitInternal(actor,tenant,id,space,key,prompt,mode,publicQuery,selected,false,scope,false);
    }
    /** System-owned generation fixes its source versions; public-only batches cannot search private library material. */
    @Transactional public Detail submitBriefing(UUID actor,UUID tenant,UUID space,UUID key,String prompt,String publicQuery,List<TaskOriginals.Selection> selected){
        return submitInternal(actor,tenant,null,space,key,prompt,"AGENT",publicQuery,selected,false,"SELECTED",true);
    }
    @Transactional public Conversation draft(UUID actor,UUID tenant,UUID space,UUID request){
        identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);access.require(actor,tenant,space,false);
        UUID prior=identities.priorRequest(actor,request,"CONVERSATION_DRAFT",IdentityService.hash(tenant+"\n"+space));
        if(prior!=null)return require(actor,tenant,prior,false);
        UUID id=UUID.randomUUID();db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,?)",id,tenant,space,actor,"新会话");
        identities.remember(actor,request,"CONVERSATION_DRAFT",IdentityService.hash(tenant+"\n"+space),id);
        return require(actor,tenant,id,false);
    }
    /** Only the explicit feedback adjustment service supplies the captured, versioned context. */
    @Transactional public Detail submitAdjustment(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt){
        return submitInternal(actor,tenant,id,space,key,prompt,"AGENT",null,List.of(),true,"WORKSPACE",false);
    }
    private Detail submitInternal(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery,List<TaskOriginals.Selection> selectedOriginals,boolean adjustment,String sourceScope,boolean systemBriefing) {
        identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);
        var selected=originals.normalize(selectedOriginals);
        if(!selected.isEmpty() && !"AGENT".equals(mode))throw new IdentityException(403,"TASK_ORIGINALS_DISABLED");
        if(prompt==null || prompt.strip().isEmpty() || mode==null || !Set.of("SOURCE_LOOKUP","AGENT").contains(mode) || prompt.length()>(adjustment?12000:"AGENT".equals(mode)?2000:200) || ("SOURCE_LOOKUP".equals(mode) && prompt.strip().split("\\s+").length>8) || prompt.codePoints().anyMatch(c->Character.isISOControl(c) && c!=10 && c!=13 && c!=9))throw IdentityException.invalid();
        publicQuery=publicQuery==null || publicQuery.isBlank()?null:publicQuery.strip();
        if(publicQuery!=null && (!"AGENT".equals(mode) || publicQuery.length()>2048 || (!publicQuery.toLowerCase(Locale.ROOT).startsWith("https://") && publicQuery.length()>200) || publicQuery.codePoints().anyMatch(Character::isISOControl)))throw IdentityException.invalid();
        prompt=prompt.strip();String fingerprint=IdentityService.hash(publicQuery==null?tenant+"\n"+id+"\n"+space+"\n"+mode+"\n"+prompt:"public-query-v1\n"+json.writeValueAsString(new Object[]{tenant,id,space,mode,prompt,publicQuery}));
        if(adjustment)fingerprint=IdentityService.hash("briefing-adjustment-v1\n"+fingerprint);
        if(!selected.isEmpty())fingerprint=IdentityService.hash("originals-v1\n"+json.writeValueAsString(new Object[]{tenant,id,space,mode,prompt,publicQuery,selected}));
        if(!"WORKSPACE".equals(sourceScope))fingerprint=IdentityService.hash(fingerprint+"\n"+sourceScope);
        UUID prior=identities.priorRequest(actor,key,"CONVERSATION_SEND",fingerprint);
        if(prior!=null)return detailInternal(actor,tenant,prior,0,20,systemBriefing);
        if(!enabled)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
        if(publicQuery!=null && !agentSettings.publicWebEnabled())throw new IdentityException(403,"PUBLIC_WEB_DISABLED");
        if(id==null){if(space==null)throw IdentityException.invalid();access.require(actor,tenant,space,false);id=UUID.randomUUID();String title=systemBriefing?"画报生成记录":adjustment?"画报调整会话":prompt.substring(0,Math.min(80,prompt.length()));db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title,purpose) VALUES (?,?,?,?,?,?)",id,tenant,space,actor,title,systemBriefing?"BRIEFING_GENERATION":adjustment?"BRIEFING_ADJUSTMENT":"BUSINESS");}
        else {var conversation=require(actor,tenant,id,true);if(Boolean.TRUE.equals(db.queryForObject("SELECT purpose='BRIEFING_GENERATION' FROM conversations WHERE id=?",Boolean.class,id)))throw new IdentityException(409,"CONVERSATION_PURPOSE_MISMATCH");if(adjustment!=db.queryForObject("SELECT purpose='BRIEFING_ADJUSTMENT' FROM conversations WHERE id=?",Boolean.class,id))throw new IdentityException(409,"CONVERSATION_PURPOSE_MISMATCH");if(space!=null && !space.equals(conversation.workspaceId()))throw IdentityException.invalid();space=conversation.workspaceId();}
        if(db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE conversation_id=? AND status IN ('QUEUED','RUNNING')",Integer.class,id)>0)throw new IdentityException(409,"CONVERSATION_BUSY");
        String state="AGENT".equals(mode) && !agentSettings.enabled()?"WAITING_CAPABILITY":"QUEUED";
        UUID task=UUID.randomUUID();db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,execution_class,public_query,wait_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",task,tenant,space,id,actor,prompt,mode,state,"AGENT".equals(mode) && agentSettings.enabled()?agentSettings.mode():null,publicQuery,state.equals("WAITING_CAPABILITY")?"MODEL_NOT_CONFIGURED":null);
        db.update("UPDATE conversation_tasks SET source_scope=?,origin=? WHERE id=?",sourceScope,systemBriefing?"SYSTEM_BRIEFING":"USER",task);
        if(!systemBriefing)db.update("UPDATE conversations SET title=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM briefing_discussions WHERE conversation_id=conversations.id) AND NOT EXISTS(SELECT 1 FROM conversation_tasks WHERE conversation_id=? AND id<>?)",prompt.substring(0,Math.min(80,prompt.length())),id,id,task);
        originals.select(actor,tenant,space,task,selected);
        event(tenant,space,id,task,state,0);db.update("UPDATE conversations SET updated_at=now() WHERE id=?",id);
        identities.remember(actor,key,"CONVERSATION_SEND",fingerprint,id);audit.record(actor,tenant,systemBriefing?"BRIEFING_GENERATION_SUBMIT":"CONVERSATION_SEND",task,"SUCCESS");return detailInternal(actor,tenant,id,0,20,systemBriefing);
    }
    @Transactional public Detail action(UUID actor,UUID tenant,UUID conversation,UUID task,UUID key,int revision,String action) {return action(actor,tenant,conversation,task,key,revision,action,null);}
    @Transactional public Detail action(UUID actor,UUID tenant,UUID conversation,UUID task,UUID key,int revision,String action,String input) {return action(actor,tenant,conversation,task,key,revision,action,input,null);}
    @Transactional public Detail action(UUID actor,UUID tenant,UUID conversation,UUID task,UUID key,int revision,String action,String input,List<TaskOriginals.Selection> additions) {
        if(action==null || !Set.of("CANCEL","RETRY","PAUSE","RESUME","RECONCILE","SUPPLEMENT").contains(action))throw IdentityException.invalid();
        input=input==null || input.isBlank()?null:input.strip();
        if(input!=null && (!Set.of("RESUME","RETRY","SUPPLEMENT").contains(action) || input.length()>2000 || input.codePoints().anyMatch(c->Character.isISOControl(c) && c!=10 && c!=13 && c!=9)))throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(input==null && Set.of("CANCEL","RETRY").contains(action)?tenant+"\n"+conversation+"\n"+task+"\n"+revision+"\n"+action:json.writeValueAsString(new Object[]{tenant,conversation,task,revision,action,input}));
        var selected=originals.normalize(additions);
        if(!selected.isEmpty() && !Set.of("RESUME","RETRY","SUPPLEMENT").contains(action))throw IdentityException.invalid();
        if("SUPPLEMENT".equals(action) && input==null)throw IdentityException.invalid();
        if(!selected.isEmpty())fingerprint=IdentityService.hash(fingerprint+"\n"+selected.toString());
        UUID prior=identities.priorRequest(actor,key,"CONVERSATION_ACTION",fingerprint);var c=require(actor,tenant,conversation,true);
        if(prior!=null)return detail(actor,tenant,conversation,0,20);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT object_is_active('TASK',?)",Boolean.class,task)))throw new IdentityException(404,"TASK_NOT_FOUND");
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND id=? FOR UPDATE",tenant,conversation,task);
        if(rows.isEmpty())throw new IdentityException(404,"CONVERSATION_NOT_FOUND");var row=rows.getFirst();String state=(String)row.get("status");
        if("SYSTEM_BRIEFING".equals(row.get("origin")))throw new IdentityException(409,"CONVERSATION_PURPOSE_MISMATCH");
        if(revision!=(Integer)row.get("revision"))throw new IdentityException(409,"TASK_STATE_CHANGED");
        if("RESUME".equals(action) && Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_presentations WHERE task_id=? AND state='DRAFT')",Boolean.class,task)))throw new IdentityException(409,"PRESENTATION_CONFIRMATION_REQUIRED");
        boolean stopping=Set.of("PAUSE","CANCEL").contains(action), reconcile=action.equals("RECONCILE");
        String next,reason=null;String supplemental=(String)row.get("supplemental_input");String execution=(String)row.get("execution_class");
        if(reconcile){
            if(!Boolean.TRUE.equals(row.get("reconciliation_required")))throw new IdentityException(409,"TASK_STATE_CHANGED");
            // This immutable server-validated allowlist contains no external business writes. User/model assertions are not evidence.
            boolean safe=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_attempts WHERE task_id=? AND attempt_number=? AND execution_policy='READ_ONLY_PRIVATE_V1' AND jsonb_typeof(allowed_tools)='array')",Boolean.class,task,row.get("attempt")));
            if(!safe)throw new IdentityException(409,"TASK_RECONCILIATION_REQUIRED");
            db.update("UPDATE conversation_attempts SET reconciliation_code='NO_BUSINESS_WRITES',reconciled_at=now() WHERE task_id=? AND attempt_number=?",task,row.get("attempt"));
            next="FAILED";reason="TASK_RESULT_RECONCILED";
        }else if(stopping){
            if(!Set.of("QUEUED","RUNNING","WAITING_INPUT","WAITING_CAPABILITY","PARTIAL","PAUSED","RESULT_UNKNOWN").contains(state) || action.equals("PAUSE") && Set.of("PAUSED","RESULT_UNKNOWN").contains(state))throw new IdentityException(409,"TASK_STATE_CHANGED");
            if(state.equals("RUNNING") && Boolean.TRUE.equals(db.queryForObject("SELECT realtime_enabled FROM conversation_attempts WHERE task_id=? AND attempt_number=?",Boolean.class,task,row.get("attempt")))) {
                db.update("UPDATE conversation_attempts SET stop_requested=true,stop_action=? WHERE task_id=? AND attempt_number=?",action,task,row.get("attempt"));
                event(tenant,c.workspaceId(),conversation,task,"LIVE",revision);
                identities.remember(actor,key,"CONVERSATION_ACTION",fingerprint,task);
                return detail(actor,tenant,conversation,0,20);
            }
            next=action.equals("CANCEL")?"CANCELLED":"PAUSED";
            if(state.equals("RUNNING"))usage.terminal(task,(UUID)row.get("lease_token"),next);
        }else{
            if(!planGate.allows(task))throw new IdentityException(409,"TASK_PLAN_INACTIVE");
            if(Boolean.TRUE.equals(row.get("reconciliation_required")))throw new IdentityException(409,"TASK_RECONCILIATION_REQUIRED");
            if(action.equals("SUPPLEMENT")?!Set.of("QUEUED","RUNNING").contains(state):action.equals("RETRY")?!Set.of("FAILED","CANCELLED","INTERRUPTED").contains(state):!Set.of("PAUSED","WAITING_INPUT","WAITING_CAPABILITY","PARTIAL").contains(state))throw new IdentityException(409,"TASK_STATE_CHANGED");
            boolean needsInput="WAITING_INPUT".equals(state);
            boolean resumeWaiting="PAUSED".equals(state) && "WAITING_INPUT".equals(row.get("resume_state")) && input==null;
            if(needsInput && input==null)throw new IdentityException(400,"TASK_INPUT_REQUIRED");
            if(input!=null){if(!"AGENT".equals(row.get("mode")))throw IdentityException.invalid();supplemental+=(supplemental.isEmpty()?"":"\n\n")+input;if(supplemental.length()>12000 || ((String)row.get("prompt")).length()+supplemental.length()+40>16000)throw new IdentityException(400,"TASK_INPUT_LIMIT");}
            if(!enabled)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
            if(row.get("public_query")!=null && !agentSettings.publicWebEnabled())throw new IdentityException(403,"PUBLIC_WEB_DISABLED");
            requireReadable(task);var files=originals.list(actor,tenant,c.workspaceId(),task);
            for(UUID chunk:db.queryForList("SELECT DISTINCT chunk_id FROM conversation_sources WHERE task_id=?",UUID.class,task))knowledge.citation(actor,tenant,chunk);
            if(!selected.isEmpty()){
                if(!"AGENT".equals(row.get("mode")))throw new IdentityException(403,"TASK_ORIGINALS_DISABLED");
                var merged=new ArrayList<TaskOriginals.Selection>();
                for(var f:files)merged.add(new TaskOriginals.Selection(f.materialId(),f.versionId()));
                for(var f:selected)if(!merged.contains(f))merged.add(f);
                originals.select(actor,tenant,c.workspaceId(),task,originals.normalize(merged));
            }
            next=resumeWaiting?"WAITING_INPUT":"QUEUED";if(resumeWaiting)reason="INPUT_REQUIRED";
            if("AGENT".equals(row.get("mode")) && !resumeWaiting){
                if(!agentSettings.enabled()){next="WAITING_CAPABILITY";reason="MODEL_NOT_CONFIGURED";}
                else if(execution!=null && !execution.equals(agentSettings.mode()))throw new IdentityException(409,"TASK_EXECUTION_MODE_CHANGED");
                else execution=agentSettings.mode();
            }
            if(next.equals("QUEUED") && db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE conversation_id=? AND status IN ('QUEUED','RUNNING') AND id<>?",Integer.class,conversation,task)>0)throw new IdentityException(409,"CONVERSATION_BUSY");
        }
        if(action.equals("SUPPLEMENT") && state.equals("RUNNING")){
            usage.terminal(task,(UUID)row.get("lease_token"),"PAUSED");
            db.update("UPDATE conversation_tasks SET status='PAUSED' WHERE id=?",task);
            archive(task);
        }
        db.update("UPDATE conversation_tasks SET status=?,revision=revision+1,lease_token=NULL,lease_until=NULL,wait_reason=?,error_code=CASE WHEN ? THEN ? ELSE error_code END,resume_state=CASE WHEN ? THEN ? ELSE resume_state END,supplemental_input=?,execution_class=?,reconciliation_required=CASE WHEN ? THEN false ELSE reconciliation_required END WHERE id=?",next,reason,reconcile,reason,action.equals("PAUSE"),state,supplemental,execution,reconcile,task);
        if(stopping && state.equals("RUNNING"))archive(task);
        event(tenant,c.workspaceId(),conversation,task,next,revision+1);identities.remember(actor,key,"CONVERSATION_ACTION",fingerprint,task);audit.record(actor,tenant,"TASK_"+action,task,"SUCCESS");return detail(actor,tenant,conversation,0,20);
    }
    void archive(UUID task){
        db.update("UPDATE conversation_attempts a SET status=t.status,finished_at=now(),snapshot=to_jsonb(t)-'lease_token'-'lease_until' FROM conversation_tasks t WHERE t.id=? AND a.task_id=t.id AND a.attempt_number=t.attempt AND a.status='RUNNING'",task);
    }
    @Transactional public Attempts attempts(UUID actor,UUID tenant,UUID conversation,UUID task,int offset,int limit){
        paging(offset,limit);if(limit>10)throw IdentityException.invalid();var c=require(actor,tenant,conversation,false);
        if(db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE id=? AND conversation_id=?",Integer.class,task,conversation)!=1)throw new IdentityException(404,"TASK_NOT_FOUND");
        requireReadable(task);originals.list(actor,tenant,c.workspaceId(),task);
        var rows=db.query("SELECT * FROM conversation_attempts WHERE task_id=? ORDER BY attempt_number DESC LIMIT ? OFFSET ?",(r,n)->{
            int number=r.getInt("attempt_number");var snap=json.readTree(r.getString("snapshot"));var sources=new ArrayList<KnowledgeService.Chunk>();
            for(UUID chunk:db.queryForList("SELECT chunk_id FROM conversation_sources WHERE task_id=? AND attempt_number=? ORDER BY ordinal",UUID.class,task,number))sources.add(knowledge.citation(actor,tenant,chunk));
            // An unfinished/failed attempt may have read sources without publishing citations; its output still depends on them.
            for(UUID chunk:db.queryForList("SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=?",UUID.class,task,r.getObject("attempt_id",UUID.class)))knowledge.citation(actor,tenant,chunk);
            var tools=new ArrayList<AgentResult.Tool>();
            if(snap.hasNonNull("tool_receipts"))tools.addAll(Arrays.asList(json.treeToValue(snap.get("tool_receipts"),AgentResult.Tool[].class)));
            else tools.addAll(db.query("SELECT sequence,name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? ORDER BY sequence",(a,i)->new AgentResult.Tool("receipt-"+a.getInt(1),a.getString(2),a.getString(3)),task,number));
            var artifacts=db.query("SELECT id,filename,sha256,octet_length(content) FROM conversation_artifacts WHERE task_id=? AND attempt_number=? AND object_is_active('ARTIFACT',id) ORDER BY filename,id",(a,i)->new Artifact(a.getObject(1,UUID.class),a.getString(2),a.getString(3),a.getInt(4)),task,number);
            return new Attempt(number,r.getString("status"),r.getString("input"),value(snap,"reply"),value(snap,"summary_code"),value(snap,"error_code"),value(snap,"engine_version"),value(snap,"model_name"),tools,sources,artifacts,r.getTimestamp("started_at")==null?null:r.getTimestamp("started_at").toInstant(),r.getTimestamp("finished_at")==null?null:r.getTimestamp("finished_at").toInstant(),r.getString("provenance"),r.getString("reconciliation_code"));
        },task,limit+1,offset);
        return new Attempts(task,rows.stream().limit(limit).toList(),rows.size()>limit);
    }
    private String value(tools.jackson.databind.JsonNode node,String field){return node.hasNonNull(field)?node.get(field).asString():null;}
    /** Internal lifecycle hook. Caller holds the tenant FOR UPDATE lock before locking task rows. */
    @Transactional public void invalidateMaterials(UUID tenant,List<UUID> materials){
        if(materials==null || materials.isEmpty())return;
        String ids=materials.stream().distinct().map(UUID::toString).collect(java.util.stream.Collectors.joining(",","{","}"));
        var affected=db.queryForList("""
            SELECT t.id FROM conversation_tasks t WHERE t.tenant_id=? AND t.status IN ('QUEUED','RUNNING') AND (
              EXISTS(SELECT 1 FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=t.id AND c.material_id=ANY(?::uuid[])) OR
              EXISTS(SELECT 1 FROM conversation_originals o WHERE o.task_id=t.id AND o.material_id=ANY(?::uuid[])) OR
              EXISTS(SELECT 1 FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=t.id AND c.material_id=ANY(?::uuid[])) OR
              EXISTS(SELECT 1 FROM conversation_task_material_versions p WHERE p.task_id=t.id AND p.material_id=ANY(?::uuid[])) OR
              EXISTS(SELECT 1 FROM feedback_task_sources d JOIN material_versions v ON v.id=d.version_id WHERE d.task_id=t.id AND v.material_id=ANY(?::uuid[])) OR
              EXISTS(SELECT 1 FROM task_context_materials d JOIN material_versions v ON v.id=d.version_id WHERE d.task_id=t.id AND v.material_id=ANY(?::uuid[])))
            ORDER BY t.id
            """,UUID.class,tenant,ids,ids,ids,ids,ids,ids);
        interruptTasks(tenant,affected,"TASK_SOURCE_UNAVAILABLE");
    }
    /** Tenant service suspension fences old leases without claiming running model work was cancelled. */
    @Transactional public void suspendTenant(UUID tenant) {
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE tenant_id=? AND status IN ('QUEUED','RUNNING') ORDER BY id FOR UPDATE",tenant);
        for(var row:rows){
            UUID task=(UUID)row.get("id");boolean unknown="RUNNING".equals(row.get("status"))&&"AGENT".equals(row.get("mode"));
            String next=unknown?"RESULT_UNKNOWN":"INTERRUPTED";
            db.update("UPDATE conversation_tasks SET status=?,reconciliation_required=reconciliation_required OR ?,revision=revision+1,error_code='TENANT_SERVICE_SUSPENDED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",next,unknown,task);
            usage.terminal(task,(UUID)row.get("lease_token"),next);archive(task);
            event(tenant,(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),task,next,(Integer)row.get("revision")+1);
        }
    }
    /** Internal atomic fence for lifecycle/plan owners. Caller acquires the tenant lock first. */
    @Transactional public void interruptTasks(UUID tenant,List<UUID> taskIds,String reason){
        if(reason==null || !Set.of("TASK_SOURCE_UNAVAILABLE","TASK_PLAN_STOPPED","TASK_PLAN_EXPIRED","TASK_MEMBER_OFFBOARDED","TASK_TENANT_EXIT","BRIEFING_CANCELLED","BRIEFING_AUTHORITY_REVOKED","BRIEFING_AUTHORITY_CHANGED","BRIEFING_TASK_UNFINISHED").contains(reason))throw IdentityException.invalid();
        if(taskIds==null || taskIds.isEmpty())return;
        String ids=taskIds.stream().distinct().map(UUID::toString).collect(java.util.stream.Collectors.joining(",","{","}"));
        var affected=db.queryForList("SELECT * FROM conversation_tasks WHERE tenant_id=? AND id=ANY(?::uuid[]) AND status IN ('QUEUED','RUNNING') ORDER BY id FOR UPDATE",tenant,ids);
        for(var row:affected){
            UUID task=(UUID)row.get("id");
            db.update("UPDATE conversation_tasks SET status='INTERRUPTED',revision=revision+1,error_code=?,wait_reason=NULL,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",reason,task);
            usage.terminal(task,(UUID)row.get("lease_token"),"INTERRUPTED");archive(task);
            event(tenant,(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),task,"INTERRUPTED",(Integer)row.get("revision")+1);
        }
    }
    @Transactional public Events events(UUID actor,UUID tenant,UUID conversation,long after) {
        if(after<0)throw IdentityException.invalid();require(actor,tenant,conversation,false);
        var items=db.query("SELECT seq,task_id,kind,revision FROM conversation_events WHERE tenant_id=? AND conversation_id=? AND seq>? ORDER BY seq LIMIT 101",(r,n)->new Event(r.getLong(1),r.getObject(2,UUID.class),r.getString(3),r.getInt(4)),tenant,conversation,after);
        var visible=items.stream().limit(100).toList();return new Events(conversation,visible,visible.isEmpty()?after:visible.getLast().seq(),items.size()>100);
    }
    @Transactional public Job claim() {
        // Serialize only short dispatch transactions, never model execution. Shared across API instances.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('conversation-task-dispatch',0))");
        // Match lifecycle/plan lock ordering: tenant before task, including expired attempts.
        var stale=db.queryForList("SELECT id,tenant_id FROM conversation_tasks WHERE status='RUNNING' AND lease_until<now() ORDER BY lease_until,id LIMIT 1");
        if(!stale.isEmpty()){
            UUID staleId=(UUID)stale.getFirst().get("id"),tenant=(UUID)stale.getFirst().get("tenant_id");
            db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);
            var expired=db.queryForList("UPDATE conversation_tasks SET status=CASE WHEN mode='AGENT' THEN 'RESULT_UNKNOWN' ELSE 'INTERRUPTED' END,reconciliation_required=(mode='AGENT'),revision=revision+1,error_code=CASE WHEN mode='AGENT' THEN 'TASK_RESULT_UNKNOWN' ELSE 'TASK_INTERRUPTED' END,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=? AND status='RUNNING' AND lease_until<now() RETURNING *",staleId);
            for(var row:expired){archive((UUID)row.get("id"));usage.expired((UUID)row.get("id"));event((UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("id"),(String)row.get("status"),(Integer)row.get("revision"));}
            return null;
        }
        var candidate=db.queryForList("""
            SELECT q.id,q.tenant_id FROM conversation_tasks q WHERE q.status='QUEUED'
            AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=q.conversation_id AND c.trashed_at IS NULL)
            AND (SELECT count(*) FROM conversation_tasks r WHERE r.status='RUNNING')<20
            AND (SELECT count(*) FROM conversation_tasks r WHERE r.status='RUNNING' AND r.tenant_id=q.tenant_id)<20
            AND (SELECT count(*) FROM conversation_tasks r WHERE r.status='RUNNING' AND r.tenant_id=q.tenant_id AND r.requested_by=q.requested_by
              AND EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.task_id=r.id)=EXISTS(SELECT 1 FROM briefing_generation_batches b WHERE b.task_id=q.id))<5
            ORDER BY q.created_at,q.id LIMIT 1
            """);if(candidate.isEmpty())return null;
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",candidate.getFirst().get("tenant_id"));
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE id=? AND status='QUEUED' FOR UPDATE SKIP LOCKED",candidate.getFirst().get("id"));if(rows.isEmpty())return null;
        var row=rows.getFirst();UUID id=(UUID)row.get("id"),token=UUID.randomUUID();
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT object_is_active('TASK',?)",Boolean.class,id))){interruptTasks((UUID)row.get("tenant_id"),List.of(id),"TASK_SOURCE_UNAVAILABLE");return null;}
        if(!departure.allowsTask(id)){interruptTasks((UUID)row.get("tenant_id"),List.of(id),departure.exiting((UUID)row.get("tenant_id"))?"TASK_TENANT_EXIT":"TASK_MEMBER_OFFBOARDED");return null;}
        if(!planGate.allows(id)){interruptTasks((UUID)row.get("tenant_id"),List.of(id),"TASK_PLAN_STOPPED");return null;}
        if("AGENT".equals(row.get("mode")) && !agentSettings.enabled()){
            db.update("UPDATE conversation_tasks SET status='WAITING_CAPABILITY',wait_reason='MODEL_NOT_CONFIGURED',revision=revision+1 WHERE id=?",id);
            event((UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),id,"WAITING_CAPABILITY",(Integer)row.get("revision")+1);return null;
        }
        String prompt=(String)row.get("prompt");String supplement=(String)row.get("supplemental_input");if(!supplement.isEmpty())prompt+="\n\n用户对本任务的补充：\n"+supplement;
        db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,started_at,provenance) VALUES (?,?,?,?,'RUNNING',now(),'RECORDED')",id,(Integer)row.get("attempt")+1,token,prompt);
        db.update("UPDATE conversation_tasks SET status='RUNNING',revision=revision+1,attempt=attempt+1,wait_reason=NULL,required_input=NULL,error_code=NULL,summary_code=NULL,reply=NULL,engine_version=NULL,model_name=NULL,model_calls=NULL,token_usage=NULL,tool_receipts=NULL,web_sources='[]',skills='[]',finished_at=NULL,lease_token=?,lease_until=now()+CASE WHEN mode='AGENT' THEN interval '90 seconds' ELSE interval '30 seconds' END WHERE id=?",token,id);
        var job=new Job(id,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("requested_by"),prompt,token,(String)row.get("mode"));
        usage.claim(job,(Integer)row.get("attempt")+1,(String)row.get("execution_class"));
        event(job.tenant(),job.space(),job.conversation(),id,"RUNNING",(Integer)row.get("revision")+1);return job;
    }
    boolean owned(Job job){return !db.queryForList("SELECT id FROM conversation_tasks WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() AND object_is_active('TASK',id) AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_tasks.conversation_id AND c.trashed_at IS NULL) FOR UPDATE",job.id(),job.token()).isEmpty() && departure.allowsTask(job.id()) && planGate.allows(job.id());}
    @Transactional public List<UUID> sources(Job job) {
        if(!"SOURCE_LOOKUP".equals(job.mode()))throw IdentityException.invalid();
        require(job.actor(),job.tenant(),job.conversation(),false);requireReadable(job.id());if(!owned(job))return null;
        return knowledge.search(job.actor(),job.tenant(),job.space(),job.prompt(),0,10).items().stream().map(KnowledgeService.Chunk::id).toList();
    }
    @Transactional public void finish(Job job,TaskRuntime.Result result) {
        if(!"SOURCE_LOOKUP".equals(job.mode()))throw IdentityException.invalid();
        require(job.actor(),job.tenant(),job.conversation(),false);requireReadable(job.id());if(!owned(job))return;
        if(!job.id().equals(result.taskId()) || !job.token().equals(result.attemptId()) || !"1.0".equals(result.contractVersion()) || !"SOURCE_LOOKUP".equals(result.mode()) || result.sourceIds()==null || result.sourceIds().size()>10 || new HashSet<>(result.sourceIds()).size()!=result.sourceIds().size() || !(result.sourceIds().isEmpty()?"NO_SOURCES":"SOURCES_FOUND").equals(result.summaryCode()))throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
        int ordinal=0;
        for(UUID id:result.sourceIds()){var source=knowledge.citation(job.actor(),job.tenant(),id);if(!source.workspaceId().equals(job.space()))throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");db.update("INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal,attempt_number) VALUES (?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?))",job.tenant(),job.space(),job.id(),id,ordinal++,job.id());}
        db.update("UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,summary_code=?,engine_version=?,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",result.summaryCode(),result.engineVersion(),job.id());
        archive(job.id());int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());event(job.tenant(),job.space(),job.conversation(),job.id(),"SUCCEEDED",revision);audit.record(job.actor(),job.tenant(),"TASK_COMPLETE",job.id(),"SUCCESS");
    }
    @Transactional public void fail(Job job,String reason) {
        String code=Set.of("TASK_SOURCE_UNAVAILABLE","TASK_RUNTIME_INCOMPATIBLE","TASK_RUNTIME_UNAVAILABLE","TASK_MODEL_FAILED","TASK_LIMIT","TASK_TOOL_FAILED","MODEL_NOT_CONFIGURED","PUBLIC_WEB_NOT_CONFIGURED","TASK_FILE_UNSUPPORTED","TASK_FILE_ENCODING","TASK_FILE_INVALID","TASK_FILE_LIMIT","TASK_FILE_DATA","TASK_RESULT_UNKNOWN").contains(reason)?reason:"TASK_RUNTIME_UNAVAILABLE";
        String state=code.equals("TASK_RESULT_UNKNOWN")?"RESULT_UNKNOWN":Set.of("MODEL_NOT_CONFIGURED","PUBLIC_WEB_NOT_CONFIGURED").contains(code)?"WAITING_CAPABILITY":"FAILED";
        var revisions=db.queryForList("UPDATE conversation_tasks SET status=?,reconciliation_required=?,wait_reason=?,revision=revision+1,error_code=?,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() RETURNING revision",Integer.class,state,state.equals("RESULT_UNKNOWN"),state.equals("WAITING_CAPABILITY")?code:null,code,job.id(),job.token());
        if(!revisions.isEmpty()){archive(job.id());usage.terminal(job.id(),job.token(),state);event(job.tenant(),job.space(),job.conversation(),job.id(),state,revisions.getFirst());}
    }
}
