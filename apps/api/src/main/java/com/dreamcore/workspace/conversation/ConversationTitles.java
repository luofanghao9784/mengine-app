package com.dreamcore.workspace.conversation;

import java.util.*;
import com.dreamcore.workspace.identity.IdentityService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Private conversation metadata. Generation is independent of the business task and its attempts. */
@Service
public class ConversationTitles {
    public record Job(UUID conversation,UUID request,UUID tenant,UUID actor,UUID source,String prompt) {}
    private final JdbcTemplate db;
    private final ConversationService conversations;
    private final AgentSettings settings;
    public ConversationTitles(JdbcTemplate db,ConversationService conversations,AgentSettings settings){
        this.db=db;this.conversations=conversations;this.settings=settings;
    }
    public static boolean substantive(String prompt){
        String text=prompt.strip().replaceAll("[\\p{P}\\p{Z}\\s]","").toLowerCase(Locale.ROOT);
        return !text.isEmpty() && !text.matches("(你好|你好啊|您好|您好啊|嗨|哈喽|hello|hi|hey|早上好|晚上好|谢谢|谢谢你|好的|ok|test|测试)+");
    }
    @Transactional public void request(UUID actor,UUID tenant,UUID conversation){
        if(!settings.enabled())return;
        var current=conversations.require(actor,tenant,conversation,true);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT purpose='BUSINESS' AND NOT EXISTS(SELECT 1 FROM briefing_discussions WHERE conversation_id=?) FROM conversations WHERE id=?",Boolean.class,conversation,conversation)))return;
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_titles WHERE conversation_id=?)",Boolean.class,conversation)))return;
        var candidates=db.queryForList("SELECT id,prompt FROM conversation_tasks WHERE conversation_id=? AND origin='USER' ORDER BY created_at,id",conversation);
        for(var candidate:candidates){
            UUID source=(UUID)candidate.get("id");String prompt=(String)candidate.get("prompt");
            if(!substantive(prompt))continue;
            conversations.requireReadable(source);
            db.update("INSERT INTO conversation_titles(conversation_id,request_id,tenant_id,actor_id,source_task_id,fallback_hash) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",conversation,UUID.randomUUID(),tenant,actor,source,IdentityService.hash(current.title()));
            break;
        }
    }
    @Transactional public Job claim(){
        // A process crash may have sent a model request: retain fallback, never silently rebill it.
        db.update("UPDATE conversation_titles SET state='UNKNOWN',finished_at=now() WHERE state='RUNNING' AND started_at<now()-interval '60 seconds'");
        var rows=db.queryForList("SELECT * FROM conversation_titles WHERE state='QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(rows.isEmpty())return null;
        var r=rows.getFirst();var job=new Job((UUID)r.get("conversation_id"),(UUID)r.get("request_id"),(UUID)r.get("tenant_id"),(UUID)r.get("actor_id"),(UUID)r.get("source_task_id"),"");
        if(!authorized(job)){terminal(job,"REVOKED");return null;}
        String prompt=db.queryForObject("SELECT prompt FROM conversation_tasks WHERE id=? AND conversation_id=?",String.class,job.source(),job.conversation());
        db.update("UPDATE conversation_titles SET state='RUNNING',started_at=now() WHERE request_id=?",job.request());
        return new Job(job.conversation(),job.request(),job.tenant(),job.actor(),job.source(),prompt);
    }
    private boolean authorized(Job job){
        try{conversations.require(job.actor(),job.tenant(),job.conversation(),false);conversations.requireReadable(job.source());return true;}
        catch(com.dreamcore.workspace.identity.IdentityException error){return false;}
    }
    public boolean active(Job job){
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_titles WHERE request_id=? AND state='RUNNING' AND started_at>now()-interval '45 seconds')",Boolean.class,job.request())) && authorized(job);
    }
    public static boolean validTitle(String title){
        return title!=null && !title.isBlank() && title.equals(title.strip()) && title.codePointCount(0,title.length())<=32
            && title.codePoints().noneMatch(c->Character.isISOControl(c)||Character.getType(c)==Character.FORMAT)
            && !title.matches("(?i)(会话标题|新会话|标题|未命名|conversation title|untitled|new conversation)") && !title.contains("\n");
    }
    @Transactional public void finish(Job job,EngineTaskRuntime.TitleResult result){
        var rows=db.queryForList("SELECT * FROM conversation_titles WHERE request_id=? AND state='RUNNING' FOR UPDATE",job.request());
        if(rows.isEmpty())return;
        if(!job.request().equals(result.requestId()) || !job.conversation().equals(result.conversationId()) || !"1.0".equals(result.contractVersion())){terminal(job,"FAILED");return;}
        if(result.inputTokens()!=null && result.outputTokens()!=null && result.inputTokens()>=0 && result.outputTokens()>=0 && result.inputTokens()<=1000000 && result.outputTokens()<=1000000)
            db.update("UPDATE conversation_titles SET input_tokens=?,output_tokens=?,model_name=? WHERE request_id=?",result.inputTokens(),result.outputTokens(),result.modelName(),job.request());
        if(!active(job)){terminal(job,"REVOKED");return;}
        if(!validTitle(result.title())){terminal(job,"FAILED");return;}
        String currentTitle=db.queryForObject("SELECT title FROM conversations WHERE id=? FOR NO KEY UPDATE",String.class,job.conversation());
        if(!IdentityService.hash(currentTitle).equals(rows.getFirst().get("fallback_hash"))){terminal(job,"SUPERSEDED");return;}
        int updated=db.update("UPDATE conversations SET title=? WHERE id=? AND tenant_id=? AND owner_id=? AND title=?",result.title(),job.conversation(),job.tenant(),job.actor(),currentTitle);
        terminal(job,updated==1?"GENERATED":"SUPERSEDED");
        if(updated==1){
            var c=conversations.require(job.actor(),job.tenant(),job.conversation(),false);
            conversations.event(job.tenant(),c.workspaceId(),job.conversation(),job.source(),"TITLE_UPDATED",0);
        }
    }
    @Transactional public void fail(Job job){if(!authorized(job))terminal(job,"REVOKED");else terminal(job,"FAILED");}
    private void terminal(Job job,String state){db.update("UPDATE conversation_titles SET state=?,finished_at=now() WHERE request_id=? AND state IN ('QUEUED','RUNNING')",state,job.request());}
}
