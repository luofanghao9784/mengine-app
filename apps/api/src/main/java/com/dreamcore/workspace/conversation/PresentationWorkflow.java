package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class PresentationWorkflow {
    public record Options(int pages,String theme) {}
    public record Edit(int index,String title) {}
    public record Confirm(UUID requestId,int expectedRevision,int draftRevision,String title,String theme,List<Edit> slides) {}
    private final JdbcTemplate db;private final ConversationService conversations;private final KnowledgeService knowledge;private final AgentSettings settings;private final boolean enabled;
    private final JsonMapper json=new JsonMapper();
    public PresentationWorkflow(JdbcTemplate db,ConversationService conversations,KnowledgeService knowledge,AgentSettings settings,@Value("${dreamcore.tasks.ppt-renderer-enabled:false}") boolean ppt,@Value("${dreamcore.tasks.artifact-transfer-enabled:false}") boolean transfer){this.db=db;this.conversations=conversations;this.knowledge=knowledge;this.settings=settings;this.enabled=ppt&&transfer;}
    public boolean available(){return enabled&&settings.enabled();}
    private void enabled(){if(!available())throw new IdentityException(503,"PRESENTATION_UNAVAILABLE");}
    @Transactional public ConversationService.Detail submit(UUID actor,UUID tenant,UUID conversation,ConversationController.Send body){
        enabled();if(body==null||body.prompt()==null||body.prompt().isBlank()||body.prompt().length()>1900||body.requestId()==null)throw IdentityException.invalid();Options options=body.presentation();if(options==null||options.pages()<1||options.pages()>8||options.theme()==null||!Set.of("ocean","ink").contains(options.theme())||!"AGENT".equals(body.mode())||body.briefingContext()!=null||body.publicQuery()!=null)throw IdentityException.invalid();
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "presentation:"+actor+":"+body.requestId());
        var result=conversations.submitClient(actor,tenant,conversation,body.workspaceId(),body.requestId(),body.prompt()+"\n\nPPT生成："+options.pages()+"页，主题 "+options.theme()+"；请先生成大纲等待确认。",body.mode(),null,body.originals(),body.sourceScope());
        var prior=db.queryForList("SELECT task_id FROM conversation_presentations WHERE send_request=?",UUID.class,body.requestId());
        if(!prior.isEmpty()&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tasks WHERE id=? AND tenant_id=? AND requested_by=?)",Boolean.class,prior.getFirst(),tenant,actor)))throw new IdentityException(409,"REQUEST_CONFLICT");
        UUID task=prior.isEmpty()?result.tasks().getLast().id():prior.getFirst();
        db.update("INSERT INTO conversation_presentations(task_id,send_request,options) VALUES (?,?,?::jsonb) ON CONFLICT DO NOTHING",task,body.requestId(),json.writeValueAsString(options));
        if(!json.readTree(db.queryForObject("SELECT options::text FROM conversation_presentations WHERE task_id=?",String.class,task)).equals(json.valueToTree(options)))throw new IdentityException(409,"REQUEST_CONFLICT");
        return result;
    }
    @SuppressWarnings("unchecked") private Map<String,Object> spec(Map<String,Object> row){return json.readValue(row.get("spec").toString(),Map.class);}
    private Map<String,Object> row(UUID task){var rows=db.queryForList("SELECT state,revision,spec::text,options::text,confirmed_request,confirmation_hash FROM conversation_presentations WHERE task_id=?",task);return rows.isEmpty()?null:rows.getFirst();}
    public boolean draft(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_presentations WHERE task_id=? AND state='DRAFT')",Boolean.class,task));}
    public boolean confirmed(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_presentations WHERE task_id=? AND state='CONFIRMED')",Boolean.class,task));}
    private List<AgentTaskService.Input> sources(ConversationService.Job job,Map<String,Object> spec,boolean grant){
        var result=new ArrayList<AgentTaskService.Input>();
        for(UUID id:PresentationSpec.sources(spec)){
            var c=knowledge.citation(job.actor(),job.tenant(),id);
            if(grant){
                db.update("INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),c.workspaceId(),job.id(),job.token(),c.materialId(),c.versionId(),c.runId());
                if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_task_material_versions WHERE task_id=? AND attempt_id=? AND material_id=? AND version_id=? AND run_id=?)",Boolean.class,job.id(),job.token(),c.materialId(),c.versionId(),c.runId())))throw new IdentityException(409,"TASK_SOURCE_UNAVAILABLE");
                db.update("INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.space(),job.id(),job.token(),id);
            }
            result.add(new AgentTaskService.Input(id,c.filename(),c.version(),c.locator(),""));
        }
        return result;
    }
    public Map<String,Object> context(ConversationService.Job job){
        var row=row(job.id());if(row==null)return Map.of("version","1.0","state","NONE");
        var result=new LinkedHashMap<String,Object>();result.put("version","1.0");result.put("state",row.get("state"));result.put("options",json.readTree(row.get("options").toString()));
        if(row.get("spec")!=null){var spec=spec(row);result.put("spec",spec);result.put("sources",sources(job,spec,true));}
        return result;
    }
    public Map<String,Object> propose(ConversationService.Job job,Map<String,Object> spec){
        enabled();PresentationSpec.validate(spec);if(json.writeValueAsBytes(spec).length>16384)throw IdentityException.invalid();
        var granted=new HashSet<>(db.queryForList("SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=?",UUID.class,job.id(),job.token()));
        if(!granted.containsAll(PresentationSpec.sources(spec)))throw new IdentityException(403,"PRESENTATION_SOURCE_NOT_GRANTED");
        sources(job,spec,false);
        var old=row(job.id());
        if(old!=null&&old.get("spec")!=null){if(!json.valueToTree(spec).equals(json.readTree(old.get("spec").toString())))throw new IdentityException(409,"PRESENTATION_DRAFT_EXISTS");return Map.of("recorded",true);}
        if(old!=null){var options=json.readTree(old.get("options").toString());if(options.has("pages")&&(options.get("pages").asInt()!=PresentationSpec.slides(spec).size()||!options.get("theme").asString().equals(spec.get("theme"))))throw new IdentityException(422,"PRESENTATION_OPTIONS_MISMATCH");}
        db.update("INSERT INTO conversation_presentations(task_id,spec,state,revision,proposed_attempt) VALUES (?,?::jsonb,'DRAFT',1,?) ON CONFLICT(task_id) DO UPDATE SET spec=excluded.spec,state='DRAFT',revision=conversation_presentations.revision+1,proposed_attempt=excluded.proposed_attempt,updated_at=now()",job.id(),json.writeValueAsString(spec),job.token());
        return Map.of("recorded",true);
    }
    @Transactional public Map<String,Object> read(UUID actor,UUID tenant,UUID conversation,UUID task){
        var detail=conversations.taskDetail(actor,tenant,conversation,task);conversations.requireReadable(task);
        var row=row(task);if(row==null)return Map.of("state","NONE");
        var result=new LinkedHashMap<String,Object>();result.put("state",row.get("state"));result.put("revision",row.get("revision"));result.put("spec",row.get("spec")==null?null:spec(row));result.put("options",json.readTree(row.get("options").toString()));
        if(row.get("spec")!=null)sources(new ConversationService.Job(task,tenant,detail.conversation().workspaceId(),conversation,actor,"",null,"AGENT"),spec(row),false);
        return result;
    }
    @Transactional public ConversationService.Detail confirm(UUID actor,UUID tenant,UUID conversation,UUID task,Confirm body){
        enabled();conversations.require(actor,tenant,conversation,true);conversations.requireReadable(task);
        if(body==null||body.requestId()==null||body.slides()==null)throw IdentityException.invalid();
        var tasks=db.queryForList("SELECT status,revision FROM conversation_tasks WHERE id=? AND conversation_id=? AND tenant_id=? FOR UPDATE",task,conversation,tenant);if(tasks.isEmpty())throw new IdentityException(404,"TASK_NOT_FOUND");
        var row=row(task);if(row==null)throw new IdentityException(404,"PRESENTATION_NOT_FOUND");
        String hash=IdentityService.hash(json.writeValueAsString(body));
        if(body.requestId().equals(row.get("confirmed_request"))&&hash.equals(row.get("confirmation_hash")))return conversations.detail(actor,tenant,conversation,0,20);
        if(!"DRAFT".equals(row.get("state"))||!Objects.equals(row.get("revision"),body.draftRevision())||!"WAITING_INPUT".equals(tasks.getFirst().get("status"))||!Objects.equals(tasks.getFirst().get("revision"),body.expectedRevision()))throw new IdentityException(409,"TASK_STATE_CHANGED");
        var spec=spec(row);var old=PresentationSpec.slides(spec);var slides=new ArrayList<Map<String,Object>>();var seen=new HashSet<Integer>();
        if(body.slides().size()!=old.size())throw IdentityException.invalid();
        for(var edit:body.slides()){if(edit==null||edit.index()<0||edit.index()>=old.size()||!seen.add(edit.index()))throw IdentityException.invalid();var slide=new LinkedHashMap<>(old.get(edit.index()));slide.put("title",edit.title());slides.add(slide);}
        spec.put("slides",slides);spec.put("title",body.title());spec.put("theme",body.theme());PresentationSpec.validate(spec);if(json.writeValueAsBytes(spec).length>16384)throw IdentityException.invalid();
        // Existing action validates current membership, frozen originals, all source grants and request idempotency.
        db.update("UPDATE conversation_presentations SET spec=?::jsonb,state='CONFIRMED',revision=revision+1,confirmed_request=?,confirmation_hash=?,updated_at=now() WHERE task_id=?",json.writeValueAsString(spec),body.requestId(),hash,task);
        return conversations.action(actor,tenant,conversation,task,body.requestId(),body.expectedRevision(),"RESUME","已确认PPT大纲，请严格按服务端保存的确认稿生成，不修改标题、内容或顺序。");
    }
}
