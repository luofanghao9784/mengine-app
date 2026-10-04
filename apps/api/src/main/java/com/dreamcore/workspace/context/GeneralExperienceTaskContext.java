package com.dreamcore.workspace.context;

import com.dreamcore.workspace.experience.ExperienceGeneralizationRuntime;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Invoked inside the authorized task transaction. Only cleaned methods cross enterprise boundaries. */
@Service
public class GeneralExperienceTaskContext {
 private final JdbcTemplate db;private final JsonMapper json=new JsonMapper();
 public GeneralExperienceTaskContext(JdbcTemplate db){this.db=db;}
 private Map<String,Object> map(Object... pairs){var m=new LinkedHashMap<String,Object>();for(int i=0;i<pairs.length;i+=2)m.put((String)pairs[i],pairs[i+1]);return m;}
 private String text(String value,int max,boolean required){String s=value==null?"":value.strip();if(s.length()>max||required&&s.isBlank()||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return s;}
 private Map<String,Object> exact(UUID tenant,UUID entry,UUID version){
  if(entry==null||version==null)throw IdentityException.invalid();
  var rows=db.queryForList("SELECT e.id,v.id version_id,v.number,v.method FROM general_experience_entries e JOIN general_experience_versions v ON v.entry_id=e.id WHERE e.id=? AND v.id=? AND general_experience_available(v.id) AND tenant_general_experience_enabled(?,e.id) FOR SHARE OF e,v",entry,version,tenant);
  if(rows.isEmpty())throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");return rows.getFirst();
 }
 private ExperienceGeneralizationRuntime.Method method(Map<String,Object> row){return json.readValue(row.get("method").toString(),ExperienceGeneralizationRuntime.Method.class);}
 private void pin(UUID task,int attempt,Map<String,Object> row){
  var old=db.queryForList("SELECT version_id FROM task_general_experience_reads WHERE task_id=? AND attempt_number=? AND entry_id=?",UUID.class,task,attempt,row.get("id"));
  if(!old.isEmpty()){if(!old.getFirst().equals(row.get("version_id")))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");return;}
  int count=db.queryForObject("SELECT (SELECT count(*) FROM task_general_experience_reads WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_context_reads WHERE task_id=? AND attempt_number=?)",Integer.class,task,attempt,task,attempt);
  if(count>=32)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
  db.update("INSERT INTO task_general_experience_reads(task_id,attempt_number,entry_id,version_id) VALUES (?,?,?,?)",task,attempt,row.get("id"),row.get("version_id"));
 }
 public Object read(UUID task,TaskContextService.Request r){
  db.queryForList("SELECT id FROM conversation_tasks WHERE id=? FOR UPDATE",task);
  var t=db.queryForMap("SELECT tenant_id,attempt,source_scope FROM conversation_tasks WHERE id=?",task);int attempt=((Number)t.get("attempt")).intValue();UUID tenant=(UUID)t.get("tenant_id");
  if("SELECTED".equals(t.get("source_scope")))return r.action().endsWith("search")?map("items",List.of(),"hasMore",false,"reason","SELECTED_ONLY"):map("unavailable",true,"reason","SELECTED_ONLY");
  int offset=r.offset()==null?0:r.offset();if(offset<0||offset>1000)throw IdentityException.invalid();
  if(r.action().equals("general_experience_search")){
   String query=text(r.query(),200,true);
   var rows=db.queryForList("SELECT e.id,v.id version_id FROM general_experience_entries e JOIN general_experience_versions v ON v.id=e.published_version WHERE general_experience_available(v.id) AND tenant_general_experience_enabled(?,e.id) AND strpos(lower(concat_ws(' ',v.method->>'title',v.method->>'summary',v.method->'tags')),lower(?))>0 ORDER BY e.updated_at DESC,e.id LIMIT 4 OFFSET ?",tenant,query,offset);
   var items=new ArrayList<Object>();for(var id:rows.stream().limit(3).toList()){
    var row=exact(tenant,(UUID)id.get("id"),(UUID)id.get("version_id"));pin(task,attempt,row);var m=method(row);
    items.add(map("entryId",row.get("id"),"versionId",row.get("version_id"),"number",row.get("number"),"title",m.title(),"summary",m.summary(),"tags",m.tags(),"authority",false));
   }
   return map("items",items,"hasMore",rows.size()>3,"scope","GENERAL_CLEANED","applicationOutcome","UNKNOWN");
  }
  var row=exact(tenant,r.referenceId(),r.versionId());var m=method(row);
  if(r.action().equals("general_experience_read")){
   if(offset>=m.steps().size())throw IdentityException.invalid();pin(task,attempt,row);
   int end=Math.min(offset+3,m.steps().size()),bits=0;for(int i=offset;i<end;i++)bits|=1<<i;
   db.update("UPDATE task_general_experience_reads SET read_bits=read_bits|? WHERE task_id=? AND attempt_number=? AND entry_id=?",bits,task,attempt,r.referenceId());
   return map("entryId",r.referenceId(),"versionId",r.versionId(),"number",row.get("number"),"title",m.title(),"summary",m.summary(),"steps",m.steps().subList(offset,end),"offset",offset,"nextOffset",end<m.steps().size()?end:null,"totalSteps",m.steps().size(),"applicable",m.applicable(),"excluded",m.excluded(),"tags",m.tags(),"basis",m.basis(),"authority",false,"requiresApplicabilityCheck",true);
  }
  if(!r.action().equals("general_experience_use")||r.requestId()==null||r.decision()==null||!Set.of("DIRECT","ADAPTED","UNKNOWN","NOT_APPLICABLE").contains(r.decision()))throw IdentityException.invalid();
  String conditions=text(r.conditions(),1000,true),adjustments=text(r.adjustments(),1000,r.decision().equals("ADAPTED"));
  var read=db.queryForList("SELECT read_bits FROM task_general_experience_reads WHERE task_id=? AND attempt_number=? AND entry_id=? AND version_id=? AND NOT invalidated",Integer.class,task,attempt,r.referenceId(),r.versionId());
  if(read.isEmpty())throw new IdentityException(409,"EXPERIENCE_READ_REQUIRED");
  if(Set.of("DIRECT","ADAPTED").contains(r.decision())&&read.getFirst()!=(1<<m.steps().size())-1)throw new IdentityException(409,"EXPERIENCE_METHOD_INCOMPLETE");
  String hash=IdentityService.hash(json.writeValueAsString(List.of(r.referenceId(),r.versionId(),r.decision(),conditions,adjustments)));
  var prior=db.queryForList("SELECT * FROM task_general_experience_reviews WHERE task_id=? AND attempt_number=? AND request_id=?",task,attempt,r.requestId());
  if(!prior.isEmpty()){if(!hash.equals(prior.getFirst().get("request_hash")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");return receipt(prior.getFirst());}
  int reviews=db.queryForObject("SELECT (SELECT count(*) FROM task_general_experience_reviews WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_context_reviews WHERE task_id=? AND attempt_number=?)",Integer.class,task,attempt,task,attempt);
  if(reviews>=8)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
  UUID id=UUID.randomUUID();db.update("INSERT INTO task_general_experience_reviews(id,task_id,attempt_number,entry_id,version_id,request_id,request_hash,decision,conditions,adjustments) VALUES (?,?,?,?,?,?,?,?,?,?)",id,task,attempt,r.referenceId(),r.versionId(),r.requestId(),hash,r.decision(),conditions,adjustments);
  return receipt(db.queryForMap("SELECT * FROM task_general_experience_reviews WHERE id=?",id));
 }
 private Object receipt(Map<String,Object> r){return map("id",r.get("id"),"versionId",r.get("version_id"),"attempt",r.get("attempt_number"),"decision",r.get("decision"),"conditions",r.get("conditions"),"adjustments",r.get("adjustments"),"selectionRecorded",Set.of("DIRECT","ADAPTED").contains(r.get("decision")),"assessmentSource","MODEL_REPORTED","applicationOutcome","UNKNOWN","businessActionPerformed",false);}
}
