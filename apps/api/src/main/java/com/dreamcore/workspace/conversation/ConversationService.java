package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.*;
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
    public record Conversation(UUID id,UUID tenantId,UUID workspaceId,String title,Instant updatedAt) {}
    public record Page(UUID tenantId,boolean enabled,List<Conversation> items,boolean hasMore,String agentMode,boolean publicWebEnabled) {}
    public record Artifact(UUID id,String filename,String sha256,int bytes) {}
    public record Task(UUID id,String prompt,String mode,String status,int revision,int attempt,String summaryCode,String errorCode,String engineVersion,boolean sourcesUnavailable,List<KnowledgeService.Chunk> sources,Instant createdAt,String reply,String executionClass,String modelName,List<Artifact> artifacts,String publicQuery,List<AgentResult.WebSource> webSources,List<AgentResult.Skill> skills,List<TaskOriginals.File> originals) {}
    public record Detail(Conversation conversation,List<Task> tasks,boolean hasMore,long cursor) {}
    public record Event(long seq,UUID taskId,String kind,int revision) {}
    public record Events(UUID conversationId,List<Event> items,long cursor,boolean hasMore) {}
    public record Job(UUID id,UUID tenant,UUID space,UUID conversation,UUID actor,String prompt,UUID token,String mode) {}
    private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
    private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final KnowledgeService knowledge;private final IdentityAudit audit;private final boolean enabled;private final AgentSettings agentSettings;private final TaskOriginals originals;private final AgentUsageLedger usage;
    public ConversationService(JdbcTemplate db,IdentityService identities,MaterialAccess access,KnowledgeService knowledge,IdentityAudit audit,@Value("${dreamcore.tasks.enabled:false}") boolean enabled,AgentSettings agentSettings,TaskOriginals originals,AgentUsageLedger usage) {this.usage=usage;this.originals=originals;this.agentSettings=agentSettings;this.db=db;this.identities=identities;this.access=access;this.knowledge=knowledge;this.audit=audit;this.enabled=enabled;}
    private final RowMapper<Conversation> mapper=(r,n)->new Conversation(r.getObject("id",UUID.class),r.getObject("tenant_id",UUID.class),r.getObject("workspace_id",UUID.class),r.getString("title"),r.getTimestamp("updated_at").toInstant());
    private void paging(int offset,int limit){if(offset<0 || offset>100000 || limit<1 || limit>50)throw IdentityException.invalid();}
    Conversation require(UUID actor,UUID tenant,UUID id,boolean lock) {
        identities.member(actor,tenant,false);
        var rows=db.query("SELECT * FROM conversations WHERE tenant_id=? AND owner_id=? AND id=?"+(lock?" FOR NO KEY UPDATE":""),mapper,tenant,actor,id);
        if(rows.isEmpty())throw new IdentityException(404,"CONVERSATION_NOT_FOUND");
        var conversation=rows.getFirst();access.require(actor,tenant,conversation.workspaceId(),false);return conversation;
    }
    void event(UUID tenant,UUID space,UUID conversation,UUID task,String kind,int revision) {
        db.update("INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision) VALUES (?,?,?,?,?,?)",tenant,space,conversation,task,kind,revision);
    }
    @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit) {
        paging(offset,limit);identities.member(actor,tenant,false);
        var found=db.query("""
          SELECT c.* FROM conversations c JOIN workspaces w ON w.tenant_id=c.tenant_id AND w.id=c.workspace_id
          LEFT JOIN workspace_members g ON g.tenant_id=c.tenant_id AND g.workspace_id=c.workspace_id AND g.account_id=?
          WHERE c.tenant_id=? AND c.owner_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
          ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?
          """,mapper,actor,tenant,actor,actor,limit+1,offset);
        return new Page(tenant,enabled,found.stream().limit(limit).toList(),found.size()>limit,agentSettings.mode(),agentSettings.publicWebEnabled());
    }
    @Transactional public Detail detail(UUID actor,UUID tenant,UUID id,int offset,int limit) {
        paging(offset,limit);var conversation=require(actor,tenant,id,false);
        // Read event cursor first: a concurrent commit may be observed twice, never missed.
        long cursor=db.queryForObject("SELECT coalesce(max(seq),0) FROM conversation_events WHERE conversation_id=?",Long.class,id);
        var tasks=db.query("SELECT * FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",(r,n)->{
            UUID task=r.getObject("id",UUID.class);var sources=new ArrayList<KnowledgeService.Chunk>();boolean unavailable=false;
            var ids=db.queryForList("SELECT chunk_id FROM conversation_sources WHERE tenant_id=? AND workspace_id=? AND task_id=? ORDER BY ordinal",UUID.class,tenant,conversation.workspaceId(),task);
            for(UUID chunk:ids)sources.add(knowledge.citation(actor,tenant,chunk));
            return new Task(task,r.getString("prompt"),r.getString("mode"),r.getString("status"),r.getInt("revision"),r.getInt("attempt"),unavailable?null:r.getString("summary_code"),r.getString("error_code"),r.getString("engine_version"),unavailable,sources,r.getTimestamp("created_at").toInstant(),r.getString("reply"),r.getString("execution_class"),r.getString("model_name"),db.query("SELECT id,filename,sha256,octet_length(content) FROM conversation_artifacts WHERE task_id=? ORDER BY filename,id",(a,i)->new Artifact(a.getObject(1,UUID.class),a.getString(2),a.getString(3),a.getInt(4)),task),r.getString("public_query"),Arrays.asList(json.readValue(r.getString("web_sources"),AgentResult.WebSource[].class)),Arrays.asList(json.readValue(r.getString("skills"),AgentResult.Skill[].class)),originals.list(actor,tenant,conversation.workspaceId(),task));
        },tenant,id,limit+1,offset);
        var visible=new ArrayList<>(tasks.stream().limit(limit).toList());Collections.reverse(visible);return new Detail(conversation,visible,tasks.size()>limit,cursor);
    }
    @Transactional public Detail historical(UUID actor,UUID tenant,UUID conversation,UUID task) {
        require(actor,tenant,conversation,true);
        var row=db.queryForList("SELECT id FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND id=? AND mode='AGENT' AND status='SUCCEEDED'",UUID.class,tenant,conversation,task);
        if(row.isEmpty())throw new IdentityException(404,"TASK_NOT_FOUND");
        int offset=db.queryForObject("SELECT count(*) FROM conversation_tasks t JOIN conversation_tasks anchor ON anchor.id=? WHERE t.conversation_id=? AND (t.created_at,t.id)>(anchor.created_at,anchor.id)",Integer.class,task,conversation);
        return detail(actor,tenant,conversation,offset,1);
    }
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode){return submit(actor,tenant,id,space,key,prompt,mode,null);}
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery) {return submit(actor,tenant,id,space,key,prompt,mode,publicQuery,List.of());}
    @Transactional public Detail submit(UUID actor,UUID tenant,UUID id,UUID space,UUID key,String prompt,String mode,String publicQuery,List<TaskOriginals.Selection> selectedOriginals) {
        var selected=originals.normalize(selectedOriginals);
        if(!selected.isEmpty() && (!"AGENT".equals(mode) || !"verification".equals(agentSettings.mode())))throw new IdentityException(403,"TASK_ORIGINALS_DISABLED");
        if(prompt==null || prompt.strip().isEmpty() || mode==null || !Set.of("SOURCE_LOOKUP","AGENT").contains(mode) || prompt.length()>("AGENT".equals(mode)?2000:200) || ("SOURCE_LOOKUP".equals(mode) && prompt.strip().split("\\s+").length>8) || prompt.codePoints().anyMatch(c->Character.isISOControl(c) && c!=10 && c!=13 && c!=9))throw IdentityException.invalid();
        publicQuery=publicQuery==null || publicQuery.isBlank()?null:publicQuery.strip();
        if(publicQuery!=null && (!"AGENT".equals(mode) || publicQuery.length()>2048 || (!publicQuery.toLowerCase(Locale.ROOT).startsWith("https://") && publicQuery.length()>200) || publicQuery.codePoints().anyMatch(Character::isISOControl)))throw IdentityException.invalid();
        prompt=prompt.strip();String fingerprint=IdentityService.hash(publicQuery==null?tenant+"\n"+id+"\n"+space+"\n"+mode+"\n"+prompt:"public-query-v1\n"+json.writeValueAsString(new Object[]{tenant,id,space,mode,prompt,publicQuery}));
        if(!selected.isEmpty())fingerprint=IdentityService.hash("originals-v1\n"+json.writeValueAsString(new Object[]{tenant,id,space,mode,prompt,publicQuery,selected}));
        UUID prior=identities.priorRequest(actor,key,"CONVERSATION_SEND",fingerprint);
        if(prior!=null)return detail(actor,tenant,prior,0,20);
        if(!enabled)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");
        if("AGENT".equals(mode) && !agentSettings.enabled())throw new IdentityException(503,"MODEL_NOT_CONFIGURED");
        if(publicQuery!=null && !agentSettings.publicWebEnabled())throw new IdentityException(403,"PUBLIC_WEB_DISABLED");
        if(id==null){if(space==null)throw IdentityException.invalid();access.require(actor,tenant,space,false);id=UUID.randomUUID();String title=prompt.substring(0,Math.min(80,prompt.length()));db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,?)",id,tenant,space,actor,title);}
        else {var conversation=require(actor,tenant,id,true);if(space!=null && !space.equals(conversation.workspaceId()))throw IdentityException.invalid();space=conversation.workspaceId();}
        if(db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE conversation_id=? AND status IN ('QUEUED','RUNNING')",Integer.class,id)>0)throw new IdentityException(409,"CONVERSATION_BUSY");
        UUID task=UUID.randomUUID();db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,execution_class,public_query) VALUES (?,?,?,?,?,?,?,'QUEUED',?,?)",task,tenant,space,id,actor,prompt,mode,"AGENT".equals(mode)?agentSettings.mode():null,publicQuery);
        originals.select(actor,tenant,space,task,selected);
        event(tenant,space,id,task,"QUEUED",0);db.update("UPDATE conversations SET updated_at=now() WHERE id=?",id);
        identities.remember(actor,key,"CONVERSATION_SEND",fingerprint,id);audit.record(actor,tenant,"CONVERSATION_SEND",task,"SUCCESS");return detail(actor,tenant,id,0,20);
    }
    @Transactional public Detail action(UUID actor,UUID tenant,UUID conversation,UUID task,UUID key,int revision,String action) {
        if(action==null || !Set.of("CANCEL","RETRY").contains(action))throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(tenant+"\n"+conversation+"\n"+task+"\n"+revision+"\n"+action);
        UUID prior=identities.priorRequest(actor,key,"CONVERSATION_ACTION",fingerprint);var c=require(actor,tenant,conversation,true);
        if(prior!=null)return detail(actor,tenant,conversation,0,20);
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE tenant_id=? AND conversation_id=? AND id=? FOR UPDATE",tenant,conversation,task);
        if(rows.isEmpty())throw new IdentityException(404,"CONVERSATION_NOT_FOUND");var row=rows.getFirst();String state=(String)row.get("status");
        if(revision!=(Integer)row.get("revision"))throw new IdentityException(409,"TASK_STATE_CHANGED");
        boolean cancel=action.equals("CANCEL");
        if(cancel?!Set.of("QUEUED","RUNNING").contains(state):!Set.of("FAILED","CANCELLED","INTERRUPTED").contains(state))throw new IdentityException(409,"TASK_STATE_CHANGED");
        if(!cancel && "AGENT".equals(row.get("mode")) && (!agentSettings.enabled() || !agentSettings.mode().equals(row.get("execution_class"))))throw new IdentityException(409,"TASK_EXECUTION_MODE_CHANGED");
        if(!cancel && row.get("public_query")!=null && !agentSettings.publicWebEnabled())throw new IdentityException(403,"PUBLIC_WEB_DISABLED");
        if(!cancel){if(!enabled)throw new IdentityException(503,"TASK_RUNTIME_UNAVAILABLE");if(db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE conversation_id=? AND status IN ('QUEUED','RUNNING')",Integer.class,conversation)>0)throw new IdentityException(409,"CONVERSATION_BUSY");}
        if(!cancel){var files=originals.list(actor,tenant,c.workspaceId(),task);if(!files.isEmpty() && !"verification".equals(agentSettings.mode()))throw new IdentityException(403,"TASK_ORIGINALS_DISABLED");}
        String next=cancel?"CANCELLED":"QUEUED";
        if(cancel)usage.terminal(task,(UUID)row.get("lease_token"),"CANCELLED");
        db.update("UPDATE conversation_tasks SET status=?,revision=revision+1,lease_token=NULL,lease_until=NULL,summary_code=NULL,error_code=NULL,engine_version=NULL,reply=NULL,model_name=NULL,model_calls=NULL,token_usage=NULL,tool_receipts=NULL,web_sources='[]',skills='[]',finished_at=CASE WHEN ? THEN now() ELSE NULL END WHERE id=?",next,cancel,task);
        event(tenant,c.workspaceId(),conversation,task,next,revision+1);identities.remember(actor,key,"CONVERSATION_ACTION",fingerprint,task);audit.record(actor,tenant,"TASK_"+action,task,"SUCCESS");return detail(actor,tenant,conversation,0,20);
    }
    @Transactional public Events events(UUID actor,UUID tenant,UUID conversation,long after) {
        if(after<0)throw IdentityException.invalid();require(actor,tenant,conversation,false);
        var items=db.query("SELECT seq,task_id,kind,revision FROM conversation_events WHERE tenant_id=? AND conversation_id=? AND seq>? ORDER BY seq LIMIT 101",(r,n)->new Event(r.getLong(1),r.getObject(2,UUID.class),r.getString(3),r.getInt(4)),tenant,conversation,after);
        var visible=items.stream().limit(100).toList();return new Events(conversation,visible,visible.isEmpty()?after:visible.getLast().seq(),items.size()>100);
    }
    @Transactional public Job claim() {
        var expired=db.queryForList("UPDATE conversation_tasks SET status='INTERRUPTED',revision=revision+1,error_code='TASK_INTERRUPTED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE status='RUNNING' AND lease_until<now() RETURNING *");
        for(var row:expired){usage.expired((UUID)row.get("id"));event((UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("id"),"INTERRUPTED",(Integer)row.get("revision"));}
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE status='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");if(rows.isEmpty())return null;
        var row=rows.getFirst();UUID id=(UUID)row.get("id"),token=UUID.randomUUID();db.update("UPDATE conversation_tasks SET status='RUNNING',revision=revision+1,attempt=attempt+1,lease_token=?,lease_until=now()+CASE WHEN mode='AGENT' THEN interval '60 seconds' ELSE interval '30 seconds' END WHERE id=?",token,id);
        var job=new Job(id,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("requested_by"),(String)row.get("prompt"),token,(String)row.get("mode"));
        usage.claim(job,(Integer)row.get("attempt")+1,(String)row.get("execution_class"));
        event(job.tenant(),job.space(),job.conversation(),id,"RUNNING",(Integer)row.get("revision")+1);return job;
    }
    boolean owned(Job job){return !db.queryForList("SELECT id FROM conversation_tasks WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() FOR UPDATE",job.id(),job.token()).isEmpty();}
    @Transactional public List<UUID> sources(Job job) {
        if(!"SOURCE_LOOKUP".equals(job.mode()))throw IdentityException.invalid();
        require(job.actor(),job.tenant(),job.conversation(),false);if(!owned(job))return null;
        return knowledge.search(job.actor(),job.tenant(),job.space(),job.prompt(),0,10).items().stream().map(KnowledgeService.Chunk::id).toList();
    }
    @Transactional public void finish(Job job,TaskRuntime.Result result) {
        if(!"SOURCE_LOOKUP".equals(job.mode()))throw IdentityException.invalid();
        require(job.actor(),job.tenant(),job.conversation(),false);if(!owned(job))return;
        if(!job.id().equals(result.taskId()) || !job.token().equals(result.attemptId()) || !"1.0".equals(result.contractVersion()) || !"SOURCE_LOOKUP".equals(result.mode()) || result.sourceIds()==null || result.sourceIds().size()>10 || new HashSet<>(result.sourceIds()).size()!=result.sourceIds().size() || !(result.sourceIds().isEmpty()?"NO_SOURCES":"SOURCES_FOUND").equals(result.summaryCode()))throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
        int ordinal=0;
        for(UUID id:result.sourceIds()){var source=knowledge.citation(job.actor(),job.tenant(),id);if(!source.workspaceId().equals(job.space()))throw new IdentityException(403,"TASK_SOURCE_UNAVAILABLE");db.update("INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal) VALUES (?,?,?,?,?)",job.tenant(),job.space(),job.id(),id,ordinal++);}
        db.update("UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,summary_code=?,engine_version=?,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",result.summaryCode(),result.engineVersion(),job.id());
        int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());event(job.tenant(),job.space(),job.conversation(),job.id(),"SUCCEEDED",revision);audit.record(job.actor(),job.tenant(),"TASK_COMPLETE",job.id(),"SUCCESS");
    }
    @Transactional public void fail(Job job,String reason) {
        String code=Set.of("TASK_SOURCE_UNAVAILABLE","TASK_RUNTIME_INCOMPATIBLE","TASK_RUNTIME_UNAVAILABLE","TASK_MODEL_FAILED","TASK_LIMIT","TASK_TOOL_FAILED","MODEL_NOT_CONFIGURED","PUBLIC_WEB_NOT_CONFIGURED","TASK_FILE_UNSUPPORTED","TASK_FILE_ENCODING","TASK_FILE_INVALID","TASK_FILE_LIMIT","TASK_FILE_DATA").contains(reason)?reason:"TASK_RUNTIME_UNAVAILABLE";
        var revisions=db.queryForList("UPDATE conversation_tasks SET status='FAILED',revision=revision+1,error_code=?,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() RETURNING revision",Integer.class,code,job.id(),job.token());
        if(!revisions.isEmpty()){usage.terminal(job.id(),job.token(),"FAILED");event(job.tenant(),job.space(),job.conversation(),job.id(),"FAILED",revisions.getFirst());}
    }
}
