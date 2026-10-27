package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Platform-owned cursor and cold history. No runtime is started by reads. */
@Service
public class NativeConversationStream {
 private final NativeConversationService sessions; private final JdbcTemplate db;
 private final JsonMapper json=new JsonMapper();
 public NativeConversationStream(NativeConversationService sessions,JdbcTemplate db){this.sessions=sessions;this.db=db;}
 public record Ingest(String key,Map<String,Object> event) {}
 @Transactional public Map<String,Object> append(UUID id,String token,Ingest input){
  sessions.check(id,token);
  if(input==null||input.key()==null||input.key().length()>200||input.event()==null)throw IdentityException.invalid();
  var event=new LinkedHashMap<>(input.event());
  if(!(event.get("type") instanceof String type)||type.length()>100||!event.containsKey("data")||json.writeValueAsString(event).length()>2000000)throw IdentityException.invalid();
  event.keySet().retainAll(Set.of("type","time","data","sessionId","nativeSeq","surfaceOp","sourceEventSeqs","ignorable"));
  if(Set.of("system/message","developer/message").contains(type))event.put("data",Map.of("redacted",true));
  boolean status=type.equals("status");
  String table=status?"native_conversation_status":"native_conversation_events";
  var prior=db.queryForList("SELECT event::text FROM "+table+" WHERE session_id=? AND receipt_key=?",String.class,id,input.key());
  if(!prior.isEmpty()){var stored=decode(prior.getFirst());var content=new LinkedHashMap<>(stored);content.remove("seq");if(!content.equals(decode(json.writeValueAsString(event))))throw new IdentityException(409,"NATIVE_EVENT_CONFLICT");return stored;}
  if(status){
   java.time.Instant incoming;try{incoming=java.time.Instant.parse((String)event.get("time"));}catch(Exception e){throw IdentityException.invalid();}
   var latest=db.queryForList("SELECT event::text FROM native_conversation_status WHERE session_id=?",String.class,id);
   if(!latest.isEmpty()){var saved=decode(latest.getFirst());if(!incoming.isAfter(java.time.Instant.parse((String)saved.get("time"))))return saved;}
  }
  long seq=db.queryForObject("UPDATE native_conversations SET event_seq=event_seq+1 WHERE id=? RETURNING event_seq",Long.class,id);
  event.put("seq",seq);
  if(status)db.update("INSERT INTO native_conversation_status(session_id,seq,receipt_key,event) VALUES (?,?,?,?::jsonb) ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq,receipt_key=excluded.receipt_key,event=excluded.event,created_at=now()",id,seq,input.key(),json.writeValueAsString(event));
  else db.update("INSERT INTO native_conversation_events(session_id,seq,receipt_key,event) VALUES (?,?,?,?::jsonb)",id,seq,input.key(),json.writeValueAsString(event));return decode(json.writeValueAsString(event));
 }
 @SuppressWarnings("unchecked") private Map<String,Object> decode(String s){return json.readValue(s,Map.class);}
 @Transactional public List<Map<String,Object>> history(UUID actor,UUID tenant,UUID id,long after,int limit){
  sessions.require(actor,tenant,id,false);if(after<0||limit<1||limit>500)throw IdentityException.invalid();
  return db.queryForList("SELECT event::text FROM native_conversation_events WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?",String.class,id,after,limit).stream().map(this::decode).toList();
 }
 @Transactional public List<Map<String,Object>> events(UUID actor,UUID tenant,UUID id,long after,int limit){
  var combined=new ArrayList<>(history(actor,tenant,id,after,limit));
  combined.addAll(db.queryForList("SELECT event::text FROM native_conversation_status WHERE session_id=? AND seq>?",String.class,id,after).stream().map(this::decode).toList());
  return combined.stream().sorted(Comparator.comparingLong(e->((Number)e.get("seq")).longValue())).limit(limit).toList();
 }
 @Transactional public Map<String,Object> status(UUID actor,UUID tenant,UUID id){
  var session=sessions.require(actor,tenant,id,false);
  var rows=db.queryForList("SELECT event::text,created_at FROM native_conversation_status WHERE session_id=?",id);
  if(rows.isEmpty())return Map.of("available",false,"state",session.state(),"reason","NO_RUNTIME_RECEIPT");
  var row=rows.getFirst();var envelope=decode((String)row.get("event"));
  var result=new LinkedHashMap<String,Object>(decode(json.writeValueAsString(envelope.get("data"))));result.put("seq",envelope.get("seq"));result.put("time",envelope.get("time"));
  java.time.Instant observed;try{observed=java.time.Instant.parse((String)envelope.get("time"));}catch(Exception e){observed=java.time.Instant.EPOCH;}
  result.put("available",session.state().equals("ACTIVE")&&observed.isAfter(java.time.Instant.now().minusSeconds(10))&&!observed.isAfter(java.time.Instant.now().plusSeconds(2)));
  result.put("state",session.state());return result;
 }
 /** Claim before dispatch. An unknown outcome is never automatically re-executed. */
 @Transactional public Map<String,Object> claim(UUID actor,UUID tenant,UUID id,UUID requestId,String action,Map<String,Object> body){
  sessions.require(actor,tenant,id,true);if(requestId==null)throw IdentityException.invalid();
  var prior=db.queryForList("SELECT action,payload::text,result::text FROM native_conversation_operations WHERE session_id=? AND request_id=?",id,requestId);
  if(!prior.isEmpty()){
   var p=prior.getFirst();if(!action.equals(p.get("action"))||!decode((String)p.get("payload")).equals(body))throw new IdentityException(409,"NATIVE_REQUEST_CONFLICT");
   if(p.get("result")==null)throw new IdentityException(409,"NATIVE_OPERATION_OUTCOME_UNKNOWN");return decode((String)p.get("result"));
  }
  db.update("INSERT INTO native_conversation_operations(session_id,request_id,action,payload) VALUES (?,?,?,?::jsonb)",id,requestId,action,json.writeValueAsString(body));return null;
 }
 @Transactional public void releaseUndispatched(UUID actor,UUID tenant,UUID id,UUID requestId){
  sessions.require(actor,tenant,id,true);
  db.update("DELETE FROM native_conversation_operations WHERE session_id=? AND request_id=? AND result IS NULL",id,requestId);
 }
 @Transactional public void complete(UUID actor,UUID tenant,UUID id,UUID requestId,Map<String,Object> result){
  sessions.require(actor,tenant,id,true);db.update("UPDATE native_conversation_operations SET result=?::jsonb WHERE session_id=? AND request_id=?",json.writeValueAsString(result),id,requestId);
 }
}
