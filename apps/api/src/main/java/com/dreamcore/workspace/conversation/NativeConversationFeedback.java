package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import tools.jackson.databind.json.JsonMapper;

@Service
public class NativeConversationFeedback {
 private final NativeConversationService sessions;private final NativeConversationStream stream;private final JdbcTemplate db;private final JsonMapper json=new JsonMapper();
 public NativeConversationFeedback(NativeConversationService sessions,NativeConversationStream stream,JdbcTemplate db){this.sessions=sessions;this.stream=stream;this.db=db;}
 @Transactional public Map<String,Object> rate(UUID actor,UUID tenant,UUID id,UUID request,String messageKey,String value){
  var session=sessions.require(actor,tenant,id,true);
  if(request==null||!Set.of("up","down").contains(value))throw IdentityException.invalid();
  long seq;try{seq=Long.parseLong(messageKey);}catch(Exception e){throw IdentityException.invalid();}
  var events=db.queryForList("SELECT event::text FROM native_conversation_events WHERE session_id=? AND seq=? AND event->>'type'='assistant/message' AND event->>'sessionId'=?",String.class,id,seq,id.toString());
  if(events.isEmpty())throw new IdentityException(404,"FEEDBACK_TARGET_UNAVAILABLE");
  var body=Map.<String,Object>of("messageKey",messageKey,"value",value);var prior=stream.claim(actor,tenant,id,request,"feedback",body);if(prior!=null)return prior;
  var existing=db.queryForList("SELECT id,revision FROM feedback_entries WHERE native_session_id=? AND native_event_seq=? AND actor_id=?",id,seq,actor);
  UUID feedback;int revision;
  if(existing.isEmpty()){
   feedback=UUID.randomUUID();revision=1;
   var snapshot=Map.of("taskState","NATIVE_EVENT","executionClass","NATIVE","contentSha256",IdentityService.hash(events.getFirst()),"sourceVersionCount",db.queryForObject("SELECT count(*) FROM native_conversation_sources WHERE session_id=?",Integer.class,id));
   db.update("INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_revision,attempt,presentation_version,presentation_revision,snapshot,native_session_id,native_event_seq) VALUES (?,?,?,?,'NATIVE',0,0,'task-v1',0,?::jsonb,?,?)",feedback,tenant,session.workspaceId(),actor,json.writeValueAsString(snapshot),id,seq);
   db.update("INSERT INTO feedback_source_versions(feedback_id,version_id) SELECT ?,version_id FROM native_conversation_sources WHERE session_id=?",feedback,id);
  }else{feedback=(UUID)existing.getFirst().get("id");revision=((Number)existing.getFirst().get("revision")).intValue()+1;db.update("UPDATE feedback_entries SET revision=?,updated_at=now() WHERE id=?",revision,feedback);}
  var assessment=Map.of("rating",value.equals("up")?"ACHIEVED":"NOT_ACHIEVED","reasons",List.of(),"suggestion","");
  db.update("INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES (?,?,?,'ACTIVE',?::jsonb)",UUID.randomUUID(),feedback,revision,json.writeValueAsString(assessment));
  var result=Map.<String,Object>of("feedbackId",feedback.toString(),"revision",revision,"messageKey",messageKey,"value",value);
  stream.complete(actor,tenant,id,request,result);return result;
 }
 @Transactional public Object list(UUID actor,UUID tenant,UUID id){sessions.require(actor,tenant,id,false);return db.queryForList("SELECT f.id,f.revision,f.native_event_seq::text AS \"messageKey\",CASE WHEN v.assessment->>'rating'='ACHIEVED' THEN 'up' ELSE 'down' END AS value FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision WHERE f.native_session_id=? AND f.actor_id=? AND NOT f.scrubbed",id,actor);}
}
