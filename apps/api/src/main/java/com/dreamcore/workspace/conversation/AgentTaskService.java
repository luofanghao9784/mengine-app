package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.context.TaskContextGuard;
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
    public record SearchResult(List<Input> items,String matchStatus,KnowledgeService.Coverage coverage,boolean hasMore) {}
    public record Download(String filename,String sha256,byte[] bytes) {}
    private final JdbcTemplate db;private final ConversationService conversations;private final KnowledgeService knowledge;private final AgentSettings settings;
    private final org.springframework.transaction.support.TransactionTemplate transactions;private final IdentityAudit audit;
    private final DatasetCalculationService datasets;private final TableCalculationService tables;private final BriefingContentService briefings;
    private final TaskOriginals originals;private final AgentUsageLedger usage;private final TaskContextGuard contextGuard;
    private final JsonMapper json=new JsonMapper();
    public AgentTaskService(JdbcTemplate db,ConversationService conversations,KnowledgeService knowledge,AgentSettings settings,org.springframework.transaction.PlatformTransactionManager manager,IdentityAudit audit,TaskOriginals originals,AgentUsageLedger usage,TaskContextGuard contextGuard,TableCalculationService tables,BriefingContentService briefings,DatasetCalculationService datasets){this.datasets=datasets;this.briefings=briefings;this.tables=tables;this.contextGuard=contextGuard;this.usage=usage;this.originals=originals;this.transactions=new org.springframework.transaction.support.TransactionTemplate(manager);this.audit=audit;this.db=db;this.conversations=conversations;this.knowledge=knowledge;this.settings=settings;}
    private IdentityException denied(){return new IdentityException(403,"TASK_ACCESS_DENIED");}
    /** Bearer is the unpredictable, short-lived attempt capability. Owner/tenant/scope come only from the DB. */
    ConversationService.Job authorized(UUID task,UUID attempt){
        if(!settings.enabled() || attempt==null)throw denied();
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE id=? AND lease_token=? AND mode='AGENT' AND status='RUNNING' AND lease_until>now()",task,attempt);
        if(rows.isEmpty())throw denied();var row=rows.getFirst();
        if(!settings.mode().equals(row.get("execution_class")))throw denied();
        if(row.get("public_query")!=null && !settings.publicWebEnabled())throw denied();
        var job=new ConversationService.Job(task,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("requested_by"),(String)row.get("prompt"),attempt,"AGENT");
        conversations.require(job.actor(),job.tenant(),job.conversation(),false);conversations.requireReadable(job.id());
        if(!conversations.owned(job))throw denied();
        contextGuard.requireCurrent(task);
        // PostgreSQL now() is fixed at transaction start; recheck wall time after any row-lock wait.
        if(db.queryForObject("SELECT lease_until>clock_timestamp() FROM conversation_tasks WHERE id=?",Boolean.class,task)!=Boolean.TRUE)throw denied();
        var selected=originals.list(job.actor(),job.tenant(),job.space(),job.id());
        var selectedIds=selected.stream().map(TaskOriginals.File::versionId).toList();
        for(UUID id:grants(job)){var citation=knowledge.citation(job.actor(),job.tenant(),id);if("WORKSPACE".equals(scope(task)) && !citation.workspaceId().equals(job.space()) || ("SELECTED".equals(scope(task)) || "WORKSPACE".equals(scope(task)) && !selectedIds.isEmpty()) && !selectedIds.contains(citation.versionId()))throw denied();}
        return job;
    }
    private String scope(UUID task){return db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?",String.class,task);}
    private List<UUID> grants(ConversationService.Job job){return db.queryForList("SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=? ORDER BY chunk_id",UUID.class,job.id(),job.token());}
    @Transactional public Map<String,Object> check(UUID task,UUID attempt){authorized(task,attempt);String query=db.queryForObject("SELECT public_query FROM conversation_tasks WHERE id=?",String.class,task);var response=new LinkedHashMap<String,Object>(Map.of("allowed",true,"executionClass",settings.mode(),"publicQuery",query==null?"":query,"candidateTrialsAllowed",settings.candidateTrialsEnabled() && query!=null,"contextVersion","1.0","taskWorkVersion","1.0","tableComparisonVersion",tables.available()?"1.0":"","briefingContentVersion","1.0","planManagementVersion","1.0","planAllowed",db.queryForObject("SELECT EXISTS(SELECT 1 FROM ongoing_plan_runs WHERE task_id=?)",Boolean.class,task)));response.put("datasetComparisonVersion","1.0");response.put("datasetContextVersion","1.0");response.put("realtimeVersion","1.0");response.put("briefingGeneration",db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=?)",Boolean.class,task));return response;}
    public record ExecutionOpen(String contractVersion,List<String> tools) {}
    public record ToolReceipt(Integer sequence,String name,String status) {}
    private static final Set<String> REGISTERED_TOOLS=Set.of("deliver_briefing","compare_table","compare_dataset","search_sources","run_javascript","find_skills","activate_skill","public_search","read_public_page","candidate_tool","list_originals","read_original","process_original","ask_user","task_control","task_context","task_plan","task_preference","manage_plan");
    @Transactional public Map<String,Object> openExecution(UUID task,UUID attempt,ExecutionOpen body){
        authorized(task,attempt);
        if(body==null || !Set.of("1.5","1.6").contains(body.contractVersion()==null?"":body.contractVersion()) || body.tools()==null || body.tools().isEmpty() || body.tools().size()>16 || new HashSet<>(body.tools()).size()!=body.tools().size() || body.tools().stream().anyMatch(t->t==null || !REGISTERED_TOOLS.contains(t)))throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");
        if(!settings.mode().equals("verification") && body.tools().stream().anyMatch(t->Set.of("candidate_tool","run_javascript","list_originals","read_original","process_original").contains(t)))throw denied();
        if(body.tools().contains("task_plan")&&db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE task_id=?",Integer.class,task)==0)throw denied();
        if(body.contractVersion().equals("1.5")&&body.tools().stream().anyMatch(t->Set.of("task_plan","task_preference","manage_plan").contains(t)))throw denied();
        String policy=body.contractVersion().equals("1.6")?"SCOPED_PRIVATE_V2":"READ_ONLY_PRIVATE_V1";
        var row=db.queryForMap("SELECT execution_policy,allowed_tools FROM conversation_attempts WHERE task_id=? AND attempt_id=? FOR UPDATE",task,attempt);
        String encoded=json.writeValueAsString(body.tools().stream().sorted().toList());
        if(row.get("execution_policy")!=null && (!policy.equals(row.get("execution_policy")) || !json.readTree(row.get("allowed_tools").toString()).equals(json.readTree(encoded))))throw new IdentityException(409,"TASK_STATE_CHANGED");
        db.update("UPDATE conversation_attempts SET execution_policy=?,allowed_tools=CAST(? AS jsonb) WHERE task_id=? AND attempt_id=?",policy,encoded,task,attempt);
        return Map.of("accepted",true,"policy",policy);
    }
    @Transactional public void toolReceipt(UUID task,UUID attempt,ToolReceipt body){
        authorized(task,attempt);
        if(body==null || body.sequence()==null || body.sequence()<1 || body.sequence()>8 || body.name()==null || body.status()==null || !Set.of("STARTED","succeeded","failed").contains(body.status()))throw IdentityException.invalid();
        var row=db.queryForMap("SELECT attempt_number,allowed_tools FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND execution_policy IN ('READ_ONLY_PRIVATE_V1','SCOPED_PRIVATE_V2')",task,attempt);
        if(!Arrays.asList(json.readValue(row.get("allowed_tools").toString(),String[].class)).contains(body.name()))throw denied();
        var found=db.queryForList("SELECT name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND sequence=?",task,row.get("attempt_number"),body.sequence());
        if(found.isEmpty()){
            if(Boolean.TRUE.equals(db.queryForObject("SELECT stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_id=?",Boolean.class,task,attempt)))throw new IdentityException(409,"TASK_STOPPING");
            if(!body.status().equals("STARTED") || body.sequence()!=1+db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=?",Integer.class,task,row.get("attempt_number")))throw new IdentityException(409,"TASK_STATE_CHANGED");
            db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,?,?,?,'STARTED')",task,row.get("attempt_number"),body.sequence(),body.name());
        }else{
            var prior=found.getFirst();if(!body.name().equals(prior.get("name")) || !body.status().equals(prior.get("status")) && !"STARTED".equals(prior.get("status")))throw new IdentityException(409,"TASK_STATE_CHANGED");
            db.update("UPDATE conversation_tool_receipts SET status=?,received_at=now() WHERE task_id=? AND attempt_number=? AND sequence=?",body.status(),task,row.get("attempt_number"),body.sequence());
        }
    }
    @Transactional public Map<String,Object> openUsage(UUID task,UUID attempt){authorized(task,attempt);return usage.open(task,attempt);}
    @Transactional public void startUsage(UUID task,UUID attempt,AgentUsageLedger.Start request){authorized(task,attempt);if(Boolean.TRUE.equals(db.queryForObject("SELECT stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_id=?",Boolean.class,task,attempt)))throw new IdentityException(409,"TASK_STOPPING");usage.start(task,attempt,request);}
    @Transactional public List<Input> search(UUID task,UUID attempt,String query){
        return searchResult(task,attempt,query).items();
    }
    @Transactional public SearchResult searchResult(UUID task,UUID attempt,String query){
        var job=authorized(task,attempt);if(query==null)throw IdentityException.invalid();
        // Legacy grants with conflicting versions cannot be repaired by silently choosing the latest.
        if(db.queryForObject("SELECT count(*) FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id LEFT JOIN conversation_task_material_versions p ON p.task_id=g.task_id AND p.attempt_id=g.attempt_id AND p.material_id=c.material_id WHERE g.task_id=? AND g.attempt_id=? AND (p.material_id IS NULL OR p.version_id<>c.version_id OR p.run_id<>c.run_id)",Integer.class,task,attempt)>0)
            throw new IdentityException(409,"TASK_SOURCE_UNAVAILABLE");
        var known=new HashSet<>(grants(job));var result=new ArrayList<Input>();var included=new ArrayList<KnowledgeService.Chunk>();
        var selected=originals.list(job.actor(),job.tenant(),job.space(),job.id()).stream().map(TaskOriginals.File::versionId).toList();
        String scope=scope(task);
        var found="WORKSPACE".equals(scope)?knowledge.searchForAttempt(job.actor(),job.tenant(),job.space(),query,3,selected.isEmpty()?null:selected,task,attempt):knowledge.searchClientTask(job.actor(),job.tenant(),job.space(),query,10,("SELECTED".equals(scope) || query.isBlank() && !selected.isEmpty())?selected:null,task,attempt,job.conversation());
        boolean more=found.hasMore();
        for(var chunk:found.items()){
            if(known.size()>=10 && !known.contains(chunk.id())){more=true;continue;}
            known.add(chunk.id());included.add(chunk);
            result.add(new Input(chunk.id(),chunk.filename(),chunk.version(),chunk.locator(),chunk.content()));
        }
        var coverage=found.coverage().limited(10);
        // Actual encoded size, including control-character escaping, stays below the engine's 64 KiB callback cap.
        while(!result.isEmpty() && json.writeValueAsBytes(new SearchResult(result,found.matchStatus(),coverage,more)).length>60*1024){
            result.removeLast();included.removeLast();more=true;
        }
        for(var chunk:included){
            db.update("INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),chunk.workspaceId(),task,attempt,chunk.materialId(),chunk.versionId(),chunk.runId());
            db.update("INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.space(),task,attempt,chunk.id());known.add(chunk.id());
        }
        return new SearchResult(List.copyOf(result),found.matchStatus(),coverage,more);
    }
    @Transactional public List<TaskOriginals.File> originals(UUID task,UUID attempt){var j=authorized(task,attempt);return originals.list(j.actor(),j.tenant(),j.space(),j.id());}
    @Transactional public TaskOriginals.Content readOriginal(UUID task,UUID attempt,UUID version){var j=authorized(task,attempt);var content=originals.read(j,version);authorized(task,attempt);return content;}
    public Map<String,Object> compareTable(UUID task,UUID attempt,TableCalculationService.Request request){
        var input=transactions.execute(tx->{var job=authorized(task,attempt);
            if(db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"compare_table\"]'::jsonb",Integer.class,task,attempt)!=1)throw denied();
            if(db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='compare_table' AND status='STARTED'",Integer.class,task,task)==0)throw denied();
            return tables.input(job,request);});
        // Do not hold database locks during the sandbox process. Cancellation/revocation is rechecked before publishing.
        var result=tables.compute(input);
        return transactions.execute(tx->{var job=authorized(task,attempt);tables.input(job,request);return tables.save(job,input,result);});
    }
    @Transactional public Map<String,Object> compareDataset(UUID task,UUID attempt,DatasetCalculationService.Request request){
        var job=authorized(task,attempt);
        if(db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"compare_dataset\"]'::jsonb",Integer.class,task,attempt)!=1 || db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='compare_dataset' AND status='STARTED'",Integer.class,task,task)==0)throw denied();
        var result=datasets.calculate(job,request);authorized(task,attempt);return result;
    }
    @Transactional public Map<String,Object> deliverBriefing(UUID task,UUID attempt,BriefingContentService.Request request){
        var job=authorized(task,attempt);
        if(db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND allowed_tools @> '[\"deliver_briefing\"]'::jsonb",Integer.class,task,attempt)!=1||db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND name='deliver_briefing' AND status='STARTED'",Integer.class,task,task)==0)throw denied();
        var doc=briefings.create(job,request);
        if(doc==null){
            audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_DUPLICATE",job.token(),"SUCCESS");
            return Map.of("contractVersion","1.0","status","NO_NEW_CONTENT","reason","DUPLICATE_CONTENT");
        }
        return Map.of("contractVersion","1.0","status","PREPARED","artifactId",doc.artifactId(),"title",doc.content().title(),"visibility","PRIVATE_AFTER_TASK_SUCCEEDS");
    }
    @Transactional public BriefingContentService.Document briefing(UUID actor,UUID tenant,UUID conversation,UUID task,int revision,int attempt){
        var detail=conversations.taskDetail(actor,tenant,conversation,task);var value=detail.tasks().getFirst();
        if(value.revision()!=revision||value.attempt()!=attempt||!"SUCCEEDED".equals(value.status())||value.sourcesUnavailable())throw new IdentityException(409,"BRIEFING_VERSION_UNAVAILABLE");
        var doc=briefings.find(task,attempt);if(doc==null)throw new IdentityException(404,"BRIEFING_NOT_FOUND");download(actor,tenant,conversation,task,doc.artifactId());return doc;
    }
    public boolean active(ConversationService.Job job){try{return Boolean.TRUE.equals(transactions.execute(status->{authorized(job.id(),job.token());return true;}));}catch(IdentityException error){return false;}}
    private void incompatible(){throw new IdentityException(502,"TASK_RUNTIME_INCOMPATIBLE");}
    @Transactional public void finish(ConversationService.Job expected,AgentResult r){
        var job=authorized(expected.id(),expected.token());
        var stop=db.queryForMap("SELECT stop_requested,stop_action FROM conversation_attempts WHERE task_id=? AND attempt_id=?",job.id(),job.token());
        if(Boolean.TRUE.equals(stop.get("stop_requested"))){
            String next="PAUSE".equals(stop.get("stop_action"))?"PAUSED":"CANCELLED";
            db.update("UPDATE conversation_tasks SET status=?,revision=revision+1,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",next,job.id());
            conversations.archive(job.id());usage.terminal(job.id(),job.token(),next);
            conversations.event(job.tenant(),job.space(),job.conversation(),job.id(),next,db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id()));return;
        }
        if(r==null || !("1.4".equals(r.contractVersion()) || "1.5".equals(r.contractVersion())) || !job.id().equals(r.taskId()) || !job.token().equals(r.attemptId()) || !"AGENT".equals(r.mode()) || !settings.mode().equals(r.executionClass()) ||
           r.engineVersion()==null || !r.engineVersion().matches("[A-Za-z0-9.\\-]{1,64}") || r.modelName()==null || !r.modelName().matches("[A-Za-z0-9._\\-]{1,80}") ||
           r.text()==null || r.text().isBlank() || r.text().length()>16000 || r.modelCalls()<1 || r.modelCalls()>8 ||
           r.sourceIds()==null || r.sourceIds().size()>10 || new HashSet<>(r.sourceIds()).size()!=r.sourceIds().size() || !new HashSet<>(r.sourceIds()).equals(new HashSet<>(grants(job))) ||
           r.originalIds()==null || r.originalIds().size()>3 || new HashSet<>(r.originalIds()).size()!=r.originalIds().size() || !new HashSet<>(r.originalIds()).equals(new HashSet<>(originals.readIds(job.id(),job.token()))) ||
           r.tools()==null || r.tools().size()>8 || r.artifacts()==null || r.artifacts().size()>8)incompatible();
        if(r.usage()!=null && (r.usage().inputTokens()<0 || r.usage().outputTokens()<0 || r.usage().inputTokens()>1000000 || r.usage().outputTokens()>1000000))incompatible();
        String outcome="1.4".equals(r.contractVersion())?"COMPLETE":r.outcome();
        if(outcome==null || !Set.of("COMPLETE","PARTIAL","WAITING_INPUT","WAITING_CAPABILITY").contains(outcome) || r.requiredInput()!=null && r.requiredInput().length()>1000 || "WAITING_INPUT".equals(outcome) && (r.requiredInput()==null || r.requiredInput().isBlank()))incompatible();
        if("1.4".equals(r.contractVersion()) && (r.outcome()!=null || r.requiredInput()!=null || r.tools().stream().anyMatch(t->t!=null && (!"succeeded".equals(t.status()) || Set.of("ask_user","task_control","task_context","task_plan","task_preference","manage_plan").contains(t.name()==null?"":t.name())))))incompatible();
        if("COMPLETE".equals(outcome) && r.tools().stream().anyMatch(t->t!=null && !"succeeded".equals(t.status())))incompatible();
        if(Set.of("WAITING_INPUT","WAITING_CAPABILITY").contains(outcome) && r.tools().stream().noneMatch(t->t!=null && ("task_control".equals(t.name()) || "WAITING_INPUT".equals(outcome) && "ask_user".equals(t.name()) && Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_live_questions WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND blocking)",Boolean.class,job.id(),job.id()))) && "succeeded".equals(t.status())))incompatible();
        if("1.5".equals(r.contractVersion())){
            var stored=db.queryForList("SELECT name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) ORDER BY sequence",job.id(),job.id());
            var expectedTools=r.tools().stream().map(t->t==null?"invalid":t.name()+"/"+t.status()).sorted().toList();
            if(!stored.stream().map(t->t.get("name")+"/"+t.get("status")).sorted().toList().equals(expectedTools) || db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND attempt_id=? AND execution_policy IN ('READ_ONLY_PRIVATE_V1','SCOPED_PRIVATE_V2')",Integer.class,job.id(),job.token())!=1)incompatible();
        }
        usage.validateResult(job.id(),job.token(),r.modelCalls(),r.usage());
        var calls=new HashSet<String>();boolean code=false;
        for(var tool:r.tools()){
            if(tool==null || tool.callId()==null || !tool.callId().matches("[!-~]{1,128}") || !calls.add(tool.callId()) || (tool.status()==null || !Set.of("succeeded","failed").contains(tool.status())) || tool.name()==null || !Set.of("deliver_briefing","compare_table","compare_dataset","search_sources","run_javascript","find_skills","activate_skill","public_search","read_public_page","candidate_tool","list_originals","read_original","process_original","ask_user","task_control","task_context","task_plan","task_preference","manage_plan").contains(tool.name()))incompatible();
            if("candidate_tool".equals(tool.name())) {if(!settings.candidateTrialsEnabled() || !settings.mode().equals("verification") || db.queryForObject("SELECT public_query IS NOT NULL FROM conversation_tasks WHERE id=?",Boolean.class,job.id())!=Boolean.TRUE || r.skills()==null || r.skills().stream().noneMatch(s->s!=null && "candidate-trials".equals(s.id())))incompatible();code=code || "succeeded".equals(tool.status());}
            if("process_original".equals(tool.name())){if(!settings.mode().equals("verification") || r.originalIds().isEmpty() || r.skills()==null || r.skills().stream().noneMatch(s->s!=null && "file-processing".equals(s.id())))incompatible();code=code || "succeeded".equals(tool.status());}
            if("run_javascript".equals(tool.name())){if(!settings.mode().equals("verification"))incompatible();code=code || "succeeded".equals(tool.status());}
        }
        if(!r.originalIds().isEmpty() && r.tools().stream().noneMatch(t->"read_original".equals(t.name())))incompatible();
        if(!r.artifacts().isEmpty() && !code)incompatible();
        if(r.tools().stream().anyMatch(t->"deliver_briefing".equals(t.name())&&"succeeded".equals(t.status()))
            && briefings.find(job.id(),db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=?",Integer.class,job.id()))==null
            && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM identity_audit WHERE tenant_id=? AND target_id=? AND action='TASK_BRIEFING_DUPLICATE' AND outcome='SUCCESS')",Boolean.class,job.tenant(),job.token())))incompatible();
        validateResearch(job,r);
        int total=db.queryForObject("SELECT coalesce(sum(octet_length(content)),0) FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",Integer.class,job.id(),job.id());
        if(r.artifacts().size()+db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",Integer.class,job.id(),job.id())>8)incompatible();
        var files=new ArrayList<Download>();
        try{
            for(var artifact:r.artifacts()){
                if(artifact==null || artifact.name()==null || !artifact.name().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}") || artifact.contentBase64()==null || artifact.contentBase64().length()>90000 || artifact.sha256()==null || !artifact.sha256().matches("[0-9a-f]{64}"))incompatible();
                byte[] bytes=Base64.getDecoder().decode(artifact.contentBase64());total+=bytes.length;
                if(total>65536 || !Base64.getEncoder().encodeToString(bytes).equals(artifact.contentBase64()) || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(artifact.sha256()))incompatible();
                files.add(new Download(artifact.name(),artifact.sha256(),bytes));
            }
        }catch(IdentityException error){throw error;}catch(Exception error){incompatible();}
        int ordinal=0;
        for(UUID source:r.sourceIds())db.update("INSERT INTO conversation_sources(tenant_id,workspace_id,task_id,chunk_id,ordinal,attempt_number) VALUES (?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?))",job.tenant(),job.space(),job.id(),source,ordinal++,job.id());
        for(var file:files)db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,(SELECT attempt FROM conversation_tasks WHERE id=?))",UUID.randomUUID(),job.tenant(),job.space(),job.id(),file.filename(),file.sha256(),file.bytes(),job.id());
        String state="COMPLETE".equals(outcome)?"SUCCEEDED":outcome;
        String waitReason="WAITING_INPUT".equals(state)?"INPUT_REQUIRED":"WAITING_CAPABILITY".equals(state)?"CAPABILITY_UNAVAILABLE":null;
        db.update("UPDATE conversation_tasks SET status=?,wait_reason=?,required_input=?,revision=revision+1,reply=?,model_name=?,model_calls=?,token_usage=CAST(? AS jsonb),tool_receipts=CAST(? AS jsonb),engine_version=?,web_sources=CAST(? AS jsonb),skills=CAST(? AS jsonb),lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",state,waitReason,r.requiredInput(),r.text(),r.modelName(),r.modelCalls(),json.writeValueAsString(r.usage()),json.writeValueAsString(r.tools()),r.engineVersion(),json.writeValueAsString(r.webSources()),json.writeValueAsString(r.skills()),job.id());
        conversations.archive(job.id());usage.terminal(job.id(),job.token(),state);
        int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());conversations.event(job.tenant(),job.space(),job.conversation(),job.id(),state,revision);audit.record(job.actor(),job.tenant(),state.equals("SUCCEEDED")?"TASK_COMPLETE":"TASK_"+state,job.id(),"SUCCESS");
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
        var context=conversations.require(actor,tenant,conversation,false);conversations.requireReadable(task);
        var rows=db.query("SELECT a.filename,a.sha256,a.content FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id WHERE a.tenant_id=? AND a.workspace_id=? AND a.task_id=? AND a.id=? AND object_is_active('ARTIFACT',a.id) AND t.conversation_id=? AND EXISTS(SELECT 1 FROM conversation_attempts h WHERE h.task_id=t.id AND h.attempt_number=a.attempt_number AND h.status IN ('SUCCEEDED','PARTIAL','WAITING_INPUT','WAITING_CAPABILITY'))",(rs,n)->new Download(rs.getString(1),rs.getString(2),rs.getBytes(3)),tenant,context.workspaceId(),task,artifact,conversation);
        if(rows.isEmpty())throw new IdentityException(404,"ARTIFACT_NOT_FOUND");
        for(UUID id:db.queryForList("SELECT chunk_id FROM conversation_sources WHERE task_id=?",UUID.class,task))knowledge.citation(actor,tenant,id);
        originals.list(actor,tenant,context.workspaceId(),task);
        return rows.getFirst();
    }
}
