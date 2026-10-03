package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Durable, permission-filtered product projection; never accepts raw Harness events. */
@Service
public class ConversationRealtime {
    public record Output(int step,int version,String text,String state) {}
    public record Question(UUID id,String text,List<String> options,boolean blocking) {}
    public record Input(UUID requestId,int attempt,String text,UUID questionId) {}
    public record Applied(UUID id) {}
    private final JdbcTemplate db;private final ConversationService conversations;private final AgentTaskService agents;private final AgentUsageLedger usage;
    private final JsonMapper json=new JsonMapper();
    private final IdentityService identities;
    public ConversationRealtime(JdbcTemplate db,ConversationService conversations,AgentTaskService agents,AgentUsageLedger usage,IdentityService identities){this.identities=identities;this.usage=usage;this.db=db;this.conversations=conversations;this.agents=agents;}
    public boolean sessionActive(UUID actor,String sessionId,long version){
        return identities.validSession(actor,version) && db.queryForObject("SELECT count(*) FROM spring_session WHERE session_id=? AND principal_name=? AND expiry_time>?",Integer.class,sessionId,actor.toString(),System.currentTimeMillis())==1;
    }
    private int number(UUID task,UUID attempt){return db.queryForObject("SELECT attempt_number FROM conversation_attempts WHERE task_id=? AND attempt_id=?",Integer.class,task,attempt);}
    private void changed(ConversationService.Job j){int rev=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,j.id());conversations.event(j.tenant(),j.space(),j.conversation(),j.id(),"LIVE",rev);}
    @Transactional public Map<String,Object> open(UUID task,UUID attempt){var j=agents.authorized(task,attempt);db.update("UPDATE conversation_attempts SET realtime_enabled=true WHERE task_id=? AND attempt_id=?",task,attempt);changed(j);return Map.of("accepted",true);}
    @Transactional public Map<String,Object> control(UUID task,UUID attempt){
        agents.authorized(task,attempt);int n=number(task,attempt);
        return Map.of("stop",db.queryForObject("SELECT stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_id=?",Boolean.class,task,attempt),"inputs",db.queryForList("SELECT id,text FROM conversation_live_inputs WHERE task_id=? AND attempt_number=? AND NOT applied ORDER BY created_at,id",task,n));
    }
    @Transactional public void output(UUID task,UUID attempt,Output body){
        var j=agents.authorized(task,attempt);int n=number(task,attempt);
        if(body==null||body.step()<1||body.step()>8||body.version()<1||body.version()>1024||body.text()==null||body.text().length()>65536||!Set.of("STREAMING","COMPLETE","INTERRUPTED").contains(body.state()==null?"":body.state()))throw IdentityException.invalid();
        var prior=db.queryForList("SELECT * FROM conversation_live_output WHERE task_id=? AND attempt_number=? AND step=?",task,n,body.step());
        if(!prior.isEmpty()){
            var p=prior.getFirst();int version=(Integer)p.get("version");
            if(body.version()<=version){if(body.version()==version&&(!body.text().equals(p.get("text"))||!body.state().equals(p.get("state"))))throw IdentityException.conflict();return;}
            if(!"STREAMING".equals(p.get("state"))||!body.text().startsWith((String)p.get("text")))throw IdentityException.conflict();
        }
        int other=db.queryForObject("SELECT coalesce(sum(length(text)),0) FROM conversation_live_output WHERE task_id=? AND attempt_number=? AND step<>?",Integer.class,task,n,body.step());
        if(other+body.text().length()>65536)throw IdentityException.invalid();
        db.update("INSERT INTO conversation_live_output VALUES(?,?,?,?,?,?) ON CONFLICT(task_id,attempt_number,step) DO UPDATE SET version=excluded.version,text=excluded.text,state=excluded.state",task,n,body.step(),body.version(),body.text(),body.state());changed(j);
    }
    @Transactional public void started(UUID task,UUID attempt){
        var j=agents.authorized(task,attempt);int n=number(task,attempt);
        // Blocking answers were placed into the persisted next-attempt prompt by RESUME.
        // Only an actual model request in that newer attempt acknowledges their use.
        int count=db.update("UPDATE conversation_live_inputs i SET applied=true FROM conversation_live_questions q WHERE i.question_id=q.id AND i.task_id=? AND i.attempt_number<? AND NOT i.applied AND q.blocking AND q.answered AND position(i.text in (SELECT input FROM conversation_attempts WHERE task_id=? AND attempt_id=?))>0",task,n,task,attempt);
        if(count>0)changed(j);
    }
    @Transactional public void applied(UUID task,UUID attempt,Applied body){
        var j=agents.authorized(task,attempt);int n=number(task,attempt);
        if(body==null||body.id()==null)throw IdentityException.invalid();
        var text=db.queryForList("SELECT text FROM conversation_live_inputs WHERE task_id=? AND attempt_number=? AND id=? FOR UPDATE",String.class,task,n,body.id());
        if(text.isEmpty())throw IdentityException.denied();
        if(db.update("UPDATE conversation_live_inputs SET applied=true WHERE id=? AND NOT applied",body.id())>0){
            db.update("UPDATE conversation_tasks SET supplemental_input=concat_ws(E'\\n\\n',nullif(supplemental_input,''),?) WHERE id=?",text.getFirst(),task);
            db.update("UPDATE conversation_attempts SET input=input||E'\\n\\n用户途中补充：\\n'||? WHERE task_id=? AND attempt_id=?",text.getFirst(),task,attempt);changed(j);
        }
    }
    @Transactional public void question(UUID task,UUID attempt,Question q){
        var j=agents.authorized(task,attempt);int n=number(task,attempt);
        if(db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? AND name='ask_user' AND status='STARTED'",Integer.class,task,n)!=1)throw IdentityException.denied();
        if(q==null||q.id()==null||q.text()==null||q.text().isBlank()||q.text().length()>1000||q.options()==null||q.options().size()>5||q.options().stream().anyMatch(x->x==null||x.isBlank()||x.length()>120))throw IdentityException.invalid();
        var prior=db.queryForList("SELECT id FROM conversation_live_questions WHERE task_id=? AND attempt_number=?",UUID.class,task,n);
        if(!prior.isEmpty()){if(!prior.getFirst().equals(q.id()))throw IdentityException.conflict();return;}
        db.update("INSERT INTO conversation_live_questions(id,task_id,attempt_number,text,options,blocking) VALUES(?,?,?,?,CAST(? AS jsonb),?)",q.id(),task,n,q.text(),json.writeValueAsString(q.options()),q.blocking());changed(j);
    }
    @Transactional public void stopped(UUID task,UUID attempt){
        var j=agents.authorized(task,attempt);
        var row=db.queryForMap("SELECT stop_requested,stop_action FROM conversation_attempts WHERE task_id=? AND attempt_id=?",task,attempt);
        if(!Boolean.TRUE.equals(row.get("stop_requested")))throw IdentityException.conflict();
        String next="PAUSE".equals(row.get("stop_action"))?"PAUSED":"CANCELLED";
        db.update("UPDATE conversation_tasks SET status=?,revision=revision+1,lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",next,task);
        conversations.archive(task);usage.terminal(task,attempt,next);conversations.event(j.tenant(),j.space(),j.conversation(),task,next,db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,task));
    }
    @Transactional public Map<String,Object> input(UUID actor,UUID tenant,UUID conversation,UUID task,Input body){
        conversations.require(actor,tenant,conversation,true);conversations.requireReadable(task);
        if(body==null||body.requestId()==null||body.text()==null||body.text().isBlank()||body.text().length()>2000||body.text().codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();
        var rows=db.queryForList("SELECT * FROM conversation_tasks WHERE id=? AND tenant_id=? AND conversation_id=? FOR UPDATE",task,tenant,conversation);
        if(rows.isEmpty())throw IdentityException.denied();var row=rows.getFirst();
        var previous=db.queryForList("SELECT * FROM conversation_live_inputs WHERE id=?",body.requestId());
        if(!previous.isEmpty()){var old=previous.getFirst();if(!task.equals(old.get("task_id"))||body.attempt()!=(Integer)old.get("attempt_number")||!body.text().equals(old.get("text"))||!Objects.equals(body.questionId(),old.get("question_id")))throw IdentityException.conflict();return Map.of("accepted",true);}
        if(body.attempt()!=(Integer)row.get("attempt"))throw new IdentityException(409,"TASK_STATE_CHANGED");
        String status=(String)row.get("status");
        var a=db.queryForMap("SELECT realtime_enabled,stop_requested FROM conversation_attempts WHERE task_id=? AND attempt_number=?",task,body.attempt());
        if(!Boolean.TRUE.equals(a.get("realtime_enabled"))||Boolean.TRUE.equals(a.get("stop_requested")))throw new IdentityException(409,"TASK_STATE_CHANGED");
        if(db.queryForObject("SELECT count(*) FROM conversation_live_inputs WHERE task_id=? AND attempt_number=?",Integer.class,task,body.attempt())>=20)throw new IdentityException(400,"TASK_INPUT_LIMIT");
        int size=db.queryForObject("SELECT coalesce(sum(length(text)),0) FROM conversation_live_inputs WHERE task_id=? AND NOT applied",Integer.class,task);
        if(size+body.text().length()+((String)row.get("supplemental_input")).length()>10000)throw new IdentityException(400,"TASK_INPUT_LIMIT");
        if(body.questionId()!=null){
            if(db.queryForObject("SELECT count(*) FROM conversation_live_questions WHERE id=? AND task_id=? AND attempt_number=? AND NOT answered",Integer.class,body.questionId(),task,body.attempt())!=1)throw IdentityException.conflict();
            if(status.equals("RUNNING") && Boolean.TRUE.equals(db.queryForObject("SELECT blocking FROM conversation_live_questions WHERE id=?",Boolean.class,body.questionId())))throw new IdentityException(409,"TASK_QUESTION_PENDING");
        }
        if(!status.equals("RUNNING") && !(status.equals("WAITING_INPUT")&&body.questionId()!=null))throw new IdentityException(409,"TASK_STATE_CHANGED");
        if(status.equals("WAITING_INPUT"))conversations.action(actor,tenant,conversation,task,body.requestId(),(Integer)row.get("revision"),"RESUME",body.text());
        db.update("INSERT INTO conversation_live_inputs(id,task_id,attempt_number,text,applied,question_id) VALUES(?,?,?,?,?,?)",body.requestId(),task,body.attempt(),body.text(),false,body.questionId());
        if(body.questionId()!=null)db.update("UPDATE conversation_live_questions SET answered=true WHERE id=?",body.questionId());
        conversations.event(tenant,(UUID)row.get("workspace_id"),conversation,task,"LIVE",(Integer)row.get("revision"));return Map.of("accepted",true);
    }
    @Transactional public Map<String,Object> snapshot(UUID actor,UUID tenant,UUID conversation){
        conversations.require(actor,tenant,conversation,false);
        var items=new ArrayList<Map<String,Object>>();
        for(var row:db.queryForList("SELECT t.id,t.attempt,t.status,a.realtime_enabled,a.stop_requested FROM conversation_tasks t JOIN conversation_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt WHERE t.conversation_id=? ORDER BY t.created_at DESC,t.id LIMIT 20",conversation)){
            UUID task=(UUID)row.get("id");if(!conversations.sourcesReadable(task))continue;
            int n=(Integer)row.get("attempt");var item=new LinkedHashMap<String,Object>();item.put("taskId",task);item.put("attempt",n);item.put("status",row.get("status"));item.put("enabled",row.get("realtime_enabled"));item.put("stopping",row.get("stop_requested"));
            item.put("outputs",db.queryForList("SELECT step,version,text,state FROM conversation_live_output WHERE task_id=? AND attempt_number=? ORDER BY step",task,n));
            item.put("inputs",db.queryForList("SELECT i.id,i.text,i.applied,i.attempt_number AS attempt,coalesce(q.blocking AND q.answered,false) AS \"resumeAnswer\" FROM conversation_live_inputs i LEFT JOIN conversation_live_questions q ON q.id=i.question_id WHERE i.task_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 20",task));
            item.put("tools",db.queryForList("SELECT sequence,name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? ORDER BY sequence",task,n));
            item.put("questions",db.query("SELECT * FROM conversation_live_questions WHERE task_id=? AND attempt_number=?",(r,i)->Map.of("id",r.getObject("id",UUID.class),"text",r.getString("text"),"options",json.readValue(r.getString("options"),String[].class),"blocking",r.getBoolean("blocking"),"answered",r.getBoolean("answered")),task,n));items.add(item);
        }
        return Map.of("conversationId",conversation,"items",items);
    }
}
