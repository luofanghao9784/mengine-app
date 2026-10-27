package com.dreamcore.workspace.conversation;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.identity.IdentityException;
import tools.jackson.databind.json.JsonMapper;

/** Incremental, platform-owned projection. Authorization happens before reading any cached text. */
@Service
public class NativeConversationMetadata {
 private final NativeConversationService sessions;private final JdbcTemplate db;private final JsonMapper json=new JsonMapper();
 public NativeConversationMetadata(NativeConversationService sessions,JdbcTemplate db){this.sessions=sessions;this.db=db;}
 @SuppressWarnings("unchecked") private Map<String,Object> map(Object v){return v instanceof Map<?,?>?(Map<String,Object>)v:Map.of();}
 private String text(Object v){return v instanceof String s?s:"";}
 private String content(Map<String,Object> data){
  Object raw=data.get("content");if(raw==null)raw=map(data.get("message")).get("content");
  if(!(raw instanceof List<?> list))return "";
  return list.stream().map(this::map).filter(b->"text".equals(b.get("type"))).map(b->text(b.get("text"))).reduce("",(a,b)->a+"\n"+b).strip();
 }
 @SuppressWarnings("unchecked") @Transactional public Map<String,Object> describe(UUID actor,UUID tenant,UUID id,String query){
  var session=sessions.require(actor,tenant,id,false);
  db.update("INSERT INTO native_conversation_metadata(session_id,last_activity_at) VALUES (?,?) ON CONFLICT DO NOTHING",id,java.sql.Timestamp.from(session.createdAt()));
  var row=db.queryForMap("SELECT *,pending::text AS pending_text FROM native_conversation_metadata WHERE session_id=? FOR UPDATE",id);
  var pending=new LinkedHashMap<String,Object>(json.readValue((String)row.get("pending_text"),Map.class));
  String title=(String)row.get("title");long seq=((Number)row.get("last_seq")).longValue();Object last=row.get("last_activity_at");
  var events=db.queryForList("SELECT seq,event::text,created_at FROM native_conversation_events WHERE session_id=? AND seq>? ORDER BY seq",id,seq);
  for(var entry:events){
   seq=((Number)entry.get("seq")).longValue();var event=json.readValue((String)entry.get("event"),Map.class);
   if(!id.toString().equals(event.get("sessionId")))continue;
   last=entry.get("created_at");var data=map(event.get("data"));String type=text(event.get("type")),call=text(data.get("callId"));
   if(type.equals("session/title")&&!text(data.get("title")).isBlank())title=clip(text(data.get("title")));
   if(type.equals("user/message")){
    var source=map(data.get("source"));if("user-question-reply".equals(source.get("kind")))pending.remove(text(source.get("callId")));
    if(title==null&&"user".equals(source.get("kind"))&&!content(data).isBlank())title=clip(content(data).split("\\n",2)[0]);
   }
   if(type.equals("approval/asked"))pending.put(text(data.get("id")),Map.of("kind","approval"));
   if(type.equals("approval/decided"))pending.remove(text(data.get("id")));
   if(type.equals("question/asked")){
    boolean plan=data.get("questions") instanceof List<?> list&&list.stream().map(this::map).anyMatch(q->"plan-review".equals(map(q.get("intent")).get("kind")));
    pending.put(call,Map.of("kind",plan?"plan":"question"));
   }
   if(type.equals("question/closed")){
    if("ASK_TIMED_OUT".equals(data.get("outcome"))&&pending.containsKey(call)){var state=new LinkedHashMap<>(map(pending.get(call)));state.put("timedOut",true);pending.put(call,state);}else pending.remove(call);
   }
   if(type.equals("turn/end")&&"aborted".equals(map(data.get("reason")).get("kind")))pending.entrySet().removeIf(p->!Boolean.TRUE.equals(map(p.getValue()).get("timedOut")));
  }
  if(!events.isEmpty())db.update("UPDATE native_conversation_metadata SET title=?,pending=?::jsonb,last_seq=?,last_activity_at=? WHERE session_id=?",title,json.writeValueAsString(pending),seq,last,id);
  String display=row.get("manual_title") instanceof String custom?custom:title==null?"新会话":title;
  if(query!=null&&!query.isBlank()){
   String needle=query.toLowerCase(Locale.ROOT);boolean matches=display.toLowerCase(Locale.ROOT).contains(needle);
   if(!matches)for(String raw:db.queryForList("SELECT event::text FROM native_conversation_events WHERE session_id=? AND event->>'sessionId'=? AND event->>'type' IN ('user/message','assistant/message')",String.class,id,id.toString())){
    if(content(map(json.readValue(raw,Map.class).get("data"))).toLowerCase(Locale.ROOT).contains(needle)){matches=true;break;}
   }
   if(!matches)return null;
  }
  var view=new LinkedHashMap<String,Object>(json.convertValue(session,Map.class));view.put("title",display);view.put("pinned",row.get("pinned"));view.put("lastActivityAt",((java.sql.Timestamp)last).toInstant().toString());
  view.put("pending",pending.values().stream().map(this::map).map(p->p.get("kind")).distinct().sorted(Comparator.comparing(Object::toString)).toList());return view;
 }
 private String clip(String s){return s.length()>120?s.substring(0,120):s;}
 @Transactional public Map<String,Object> update(UUID actor,UUID tenant,UUID id,Map<String,Object> input){
  if(input.isEmpty()||!Set.of("title","pinned").containsAll(input.keySet()))throw IdentityException.invalid();
  sessions.require(actor,tenant,id,false);describe(actor,tenant,id,null);
  if(input.containsKey("title")){Object v=input.get("title");if(v!=null&&(!(v instanceof String s)||s.isBlank()||s.length()>120))throw IdentityException.invalid();db.update("UPDATE native_conversation_metadata SET manual_title=? WHERE session_id=?",v==null?null:((String)v).strip(),id);}
  if(input.containsKey("pinned")){if(!(input.get("pinned") instanceof Boolean))throw IdentityException.invalid();db.update("UPDATE native_conversation_metadata SET pinned=? WHERE session_id=?",input.get("pinned"),id);}
  return describe(actor,tenant,id,null);
 }
}
