package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class AgentTaskService {
    public record Input(UUID id,String filename,int version,String locator,String content) {}
    public record Download(String filename,String sha256,byte[] bytes) {}
    private final JdbcTemplate db;private final ConversationService conversations;private final KnowledgeService knowledge;private final AgentSettings settings;
    private final org.springframework.transaction.support.TransactionTemplate transactions;private final IdentityAudit audit;
    private final TaskOriginals originals;private final AgentUsageLedger usage;
    private final JsonMapper json=new JsonMapper();
    public AgentTaskService(JdbcTemplate db,ConversationService conversations,KnowledgeService knowledge,AgentSettings settings,org.springframework.transaction.PlatformTransactionManager manager,IdentityAudit audit,TaskOriginals originals,AgentUsageLedger usage){this.usage=usage;this.originals=originals;this.transactions=new org.springframework.transaction.support.TransactionTemplate(manager);this.audit=audit;this.db=db;this.conversations=conversations;this.knowledge=knowledge;this.settings=settings;}
    private IdentityException denied(){return new IdentityException(403,"TASK_ACCESS_DENIED");}
    /** Bearer is the unpredictable, short-lived attempt capability. Owner/tenant/scope come only from the DB. */
    private ConversationService.Job authorized(UUID task,UUID attempt){
        if(!settings.enabled() || attempt==null)throw denied();
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE id=? AND lease_token=? AND mode='AGENT' AND status='RUNNING' AND lease_until>now()",task,attempt);
        if(rows.isEmpty())throw denied();var row=rows.getFirst();
        if(!settings.mode().equals(row.get("execution_class")))throw denied();
        if(row.get("public_query")!=null && !settings.publicWebEnabled())throw denied();
        var job=new ConversationService.Job(task,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("requested_by"),(String)row.get("prompt"),attempt,"AGENT");
        conversations.require(job.actor(),job.tenant(),job.conversation(),false);
        if(!conversations.owned(job))throw denied();
        // PostgreSQL now() is fixed at transaction start; recheck wall time after any row-lock wait.
        if(db.queryForObject("SELECT lease_until>clock_timestamp() FROM conversation_tasks WHERE id=?",Boolean.class,task)!=Boolean.TRUE)throw denied();
        var selected=originals.list(job.actor(),job.tenant(),job.space(),job.id());
        var selectedIds=selected.stream().map(TaskOriginals.File::versionId).toList();
        for(UUID id:grants(job)){var citation=knowledge.citation(job.actor(),job.tenant(),id);if(!citation.workspaceId().equals(job.space()) || !selectedIds.isEmpty() && !selectedIds.contains(citation.versionId()))throw denied();}
        if(!selected.isEmpty() && !"verification".equals(settings.mode()))throw denied();
        return job;
    }
    private List<UUID> grants(ConversationService.Job job){return db.queryForList("SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=? ORDER BY chunk_id",UUID.class,job.id(),job.token());}
    @Transactional public Map<String,Object> check(UUID task,UUID attempt){authorized(task,attempt);String query=db.queryForObject("SELECT public_query FROM conversation_tasks WHERE id=?",String.class,task);return Map.of("allowed",true,"executionClass",settings.mode(),"publicQuery",query==null?"":query,"candidateTrialsAllowed",settings.candidateTrialsEnabled() && query!=null);}
    @Transactional public Map<String,Object> openUsage(UUID task,UUID attempt){authorized(task,attempt);return usage.open(task,attempt);}
    @Transactional public void startUsage(UUID task,UUID attempt,AgentUsageLedger.Start request){authorized(task,attempt);usage.start(task,attempt,request);}
    @Transactional public List<Input> search(UUID task,UUID attempt,String query){
        var job=authorized(task,attempt);if(query==null)throw IdentityException.invalid();
        var known=new HashSet<>(grants(job));var result=new ArrayList<Input>();
        var selected=originals.list(job.actor(),job.tenant(),job.space(),job.id()).stream().map(TaskOriginals.File::versionId).toList();
        for(var chunk:knowledge.search(job.actor(),job.tenant(),job.space(),query,0,3,selected.isEmpty()?null:selected).items()){
            if(known.size()>=10 && !known.contains(chunk.id()))continue;
            db.update("INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.space(),task,attempt,chunk.id());known.add(chunk.id());
            result.add(new Input(chunk.id(),chunk.filename(),chunk.version(),chunk.locator(),chunk.content()));
        }
        return result;
    }
    @Transactional public List<TaskOriginals.File> originals(UUID task,UUID attempt){var j=authorized(task,attempt);return originals.list(j.actor(),j.tenant(),j.space(),j.id());}
    @Transactional public TaskOriginals.Content readOriginal(UUID task,UUID attempt,UUID version){var j=authorized(task,attempt);var content=originals.read(j,version);authorized(task,attempt);return content;}
    public boolean active(ConversationService.Job job){try{return Boolean.TRUE.equals(transactions.execute(status->{authorized(job.id(),job.token());return true;}));}catch(IdentityException error){return false;}}
    private void incompatible(){throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");}
    @Transactional public void finish(ConversationService.Job expected,AgentResult r){
        var job=authorized(expected.id(),expected.token());
        if(r==null || !"1.4".equals(r.contractVersion()) || !job.id().equals(r.taskId()) || !job.token().equals(r.attemptId()) || !"AGENT".equals(r.mode()) || !settings.mode().equals(r.executionClass()) ||
           r.engineVersion()==null || !r.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}") || r.modelName()==null || !r.modelName().matches("[A-Za-z0-9._\\-]{1,80}") ||
           r.text()==null || r.text().isBlank() || r.text().length()>16000 || r.modelCalls()<1 || r.modelCalls()>8 ||
           r.sourceIds()==null || r.sourceIds().size()>10 || new HashSet<>(r.sourceIds()).size()!=r.sourceIds().size() || !new HashSet<>(r.sourceIds()).equals(new HashSet<>(grants(job))) ||
           r.originalIds()==null || r.originalIds().size()>3 || new HashSet<>(r.originalIds()).size()!=r.originalIds().size() || !new HashSet<>(r.originalIds()).equals(new HashSet<>(originals.readIds(job.id(),job.token()))) ||
           r.tools()==null || r.tools().size()>8 || r.artifacts()==null || r.artifacts().size()>8)incompatible();
        if(r.usage()!=null && (r.usage().inputTokens()<0 || r.usage().outputTokens()<0 || r.usage().inputTokens()>1000000 || r.usage().outputTokens()>1000000))incompatible();
        usage.validateResult(job.id(),job.token(),r.modelCalls(),r.usage());
        var calls=new HashSet<String>();boolean code=false;
        for(var tool:r.tools()){
            if(tool==null || tool.callId()==null || !tool.callId().matches("[!-~]{1,128}") || !calls.add(tool.callId()) || !"succeeded".equals(tool.status()) || tool.name()==null || !Set.of("search_sources","run_javascript","find_skills","activate_skill","public_search","read_public_page","candidate_tool","list_originals","read_original","process_original").contains(tool.name()))incompatible();
            if("candidate_tool".equals(tool.name())) {if(!settings.candidateTrialsEnabled() || !settings.mode().equals("verification") || db.queryForObject("SELECT public_query IS NOT NULL FROM conversation_tasks WHERE id=?",Boolean.class,job.id())!=Boolean.TRUE || r.skills()==null || r.skills().stream().noneMatch(s->s!=null && "candidate-trials".equals(s.id())))incompatible();code=true;}
            if("process_original".equals(tool.name())){if(!settings.mode().equals("verification") || r.originalIds().isEmpty() || r.skills()==null || r.skills().stream().noneMatch(s->s!=null && "file-processing".equals(s.id())))incompatible();code=true;}
            if("run_javascript".equals(tool.name())){if(!settings.mode().equals("verification"))incompatible();code=true;}
        }
        if(!r.originalIds().isEmpty() && r.tools().stream().noneMatch(t->"read_original".equals(t.name())))incompatible();
        if(!r.artifacts().isEmpty() && !code)incompatible();
        validateResearch(job,r);
        int total=0;var files=new ArrayList<Download>();
        try{
            for(var artifact:r.artifacts()){
                if(artifact==null || artifact.name()==null || !artifact.name().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}") || artifact.contentBase64()==null || artifact.contentBase64().length()>90000 || artifact.sha256()==null || !artifact.sha256().matches("[0-9a-f]{64}"))incompatible();
                byte[] bytes=Base64.getDecoder().decode(artifact.contentBase64());total+=bytes.length;
                if(total>65536 || !Base64.getEncoder().encodeToString(bytes).equals(artifact.contentBase64()) || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(artifact.sha256()))incompatible();
                files.add(new Download(artifact.name(),artifact.sha256(),bytes));
            }
        }catch(IdentityException error){throw error;}catch(Exception error){incompatible();}
        int ordinal=0;
        for(UUID source:r.sourceIds())db.update("INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal) VALUES (?,?,?,?,?)",job.tenant(),job.space(),job.id(),source,ordinal++);
        for(var file:files)db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content) VALUES (?,?,?,?,?,?,?)",UUID.randomUUID(),job.tenant(),job.space(),job.id(),file.filename(),file.sha256(),file.bytes());
        db.update("UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,reply=?,model_name=?,model_calls=?,token_usage=CAST(? AS jsonb),tool_receipts=CAST(? AS jsonb),engine_version=?,web_sources=CAST(? AS jsonb),skills=CAST(? AS jsonb),lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",r.text(),r.modelName(),r.modelCalls(),json.writeValueAsString(r.usage()),json.writeValueAsString(r.tools()),r.engineVersion(),json.writeValueAsString(r.webSources()),json.writeValueAsString(r.skills()),job.id());
        usage.terminal(job.id(),job.token(),"SUCCEEDED");
        int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());conversations.event(job.tenant(),job.space(),job.conversation(),job.id(),"SUCCEEDED",revision);audit.record(job.actor(),job.tenant(),"TASK_COMPLETE",job.id(),"SUCCESS");
    }
    private void validateResearch(ConversationService.Job job,AgentResult result){
        if(result.webSources()==null || result.webSources().size()>3 || result.skills()==null || result.skills().size()>8)incompatible();
        boolean publicAllowed=settings.publicWebEnabled() && db.queryForObject("SELECT public_query IS NOT NULL FROM conversation_tasks WHERE id=?",Boolean.class,job.id());
        if(!publicAllowed && (!result.webSources().isEmpty() || result.tools().stream().anyMatch(t->Set.of("public_search","read_public_page").contains(t.name()))))incompatible();
        var skills=new HashSet<String>();
        for(var skill:result.skills()){
            if(skill==null || skill.id()==null || !skill.id().matches("[a-z][a-z0-9-]{0,63}") || !skills.add(skill.id()) || skill.version()==null || !skill.version().matches("[0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8}") || skill.sha256()==null || !skill.sha256().matches("[a-f0-9]{64}") || "public-research".equals(skill.id()) && !publicAllowed || "candidate-trials".equals(skill.id()) && (!publicAllowed || !settings.candidateTrialsEnabled()))incompatible();
        }
        if(!skills.isEmpty() && result.tools().stream().noneMatch(t->"activate_skill".equals(t.name())))incompatible();
        if(!result.webSources().isEmpty() && (!skills.contains("public-research") || result.tools().stream().noneMatch(t->"public_search".equals(t.name()))))incompatible();
        if(result.tools().stream().anyMatch(t->Set.of("public_search","read_public_page").contains(t.name())) && !skills.contains("public-research"))incompatible();
        var ids=new HashSet<UUID>();
        for(var source:result.webSources()){
            if(source==null || source.id()==null || !ids.add(source.id()) || source.url()==null || source.url().length()>2048 || source.title()==null || source.title().length()>160 || source.excerpt()==null || source.excerpt().length()>4000 || source.sha256()==null || !source.sha256().equals(IdentityService.hash(source.excerpt())) || source.retrievedAt()==null || source.retrievedAt().isAfter(java.time.Instant.now().plusSeconds(60)) || source.kind()==null || !Set.of("SEARCH","PAGE").contains(source.kind()))incompatible();
            try{var uri=java.net.URI.create(source.url());if(!"https".equals(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getFragment()!=null || uri.getPort()!=-1 && uri.getPort()!=443)incompatible();}catch(IllegalArgumentException error){incompatible();}
            if("PAGE".equals(source.kind()) && result.tools().stream().noneMatch(t->"read_public_page".equals(t.name())))incompatible();
        }
    }
    @Transactional public Download download(UUID actor,UUID tenant,UUID conversation,UUID task,UUID artifact){
        var context=conversations.require(actor,tenant,conversation,false);
        var rows=db.query("SELECT a.filename,a.sha256,a.content FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id WHERE a.tenant_id=? AND a.workspace_id=? AND a.task_id=? AND a.id=? AND t.conversation_id=? AND t.status='SUCCEEDED'",(rs,n)->new Download(rs.getString(1),rs.getString(2),rs.getBytes(3)),tenant,context.workspaceId(),task,artifact,conversation);
        if(rows.isEmpty())throw new IdentityException(404,"ARTIFACT_NOT_FOUND");
        for(UUID id:db.queryForList("SELECT chunk_id FROM conversation_sources WHERE task_id=?",UUID.class,task))knowledge.citation(actor,tenant,id);
        originals.list(actor,tenant,context.workspaceId(),task);
        return rows.getFirst();
    }
}
