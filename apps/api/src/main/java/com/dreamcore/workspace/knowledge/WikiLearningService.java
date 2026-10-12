package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Source-bound private learning drafts. The existing task owns execution, cost and retained text. */
@Service
public class WikiLearningService {
 public record Start(UUID requestId, UUID versionId, Integer generation) {}
 public record Evidence(UUID chunkId,String quote) {}
 public record Article(String title,String intro,String content,List<Evidence> evidence) {}
 public record Fragment(UUID id,String locator,String content) {}
 public record Source(UUID materialId,UUID versionId,UUID runId,int generation,String filename,int version,List<Fragment> fragments) {}
 public record Draft(UUID id,UUID tenantId,UUID materialId,UUID versionId,UUID conversationId,UUID taskId,String sourceName,int sourceVersion,String status,String executionClass,String modelName,Article article) {}
 public record Page(List<Draft> items,boolean hasMore) {}
 private final JdbcTemplate db; private final IdentityService identities; private final MaterialAccess access;
 private final ConversationService conversations; private final IdentityAudit audit;
 private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
 public WikiLearningService(JdbcTemplate db,IdentityService identities,MaterialAccess access,ConversationService conversations,IdentityAudit audit){this.db=db;this.identities=identities;this.access=access;this.conversations=conversations;this.audit=audit;}
 private IdentityException missing(){return new IdentityException(404,"MATERIAL_NOT_FOUND");}
 private IdentityException changed(){return new IdentityException(409,"WIKI_SOURCE_CHANGED");}
 private Map<String,Object> material(UUID actor,UUID tenant,UUID id){
   identities.member(actor,tenant,false);
   var rows=db.queryForList("SELECT m.*,v.id version_id,v.filename,v.number version FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version WHERE m.id=? AND m.tenant_id=? AND w.kind='SHARED' AND m.in_library",id,tenant);
   if(rows.isEmpty())throw missing();var row=rows.getFirst();access.requireObject(actor,tenant,(UUID)row.get("workspace_id"),"MATERIAL",id,false);return row;
 }
 Source source(UUID actor,UUID tenant,UUID material,UUID version,UUID run){
   var m=material(actor,tenant,material);if(!version.equals(m.get("version_id")))throw changed();
   var runs=db.queryForList("SELECT id,generation,status FROM knowledge_runs WHERE version_id=? ORDER BY generation DESC LIMIT 1",version);
   if(runs.isEmpty() || !Set.of("READY","PARTIAL").contains(runs.getFirst().get("status")))throw changed();
   var r=runs.getFirst();if(run!=null&&!run.equals(r.get("id")))throw changed();
   var chunks=db.query("SELECT id,locator,content FROM knowledge_chunks WHERE run_id=? ORDER BY ordinal,id LIMIT 10",(rs,n)->new Fragment(rs.getObject("id",UUID.class),rs.getString("locator"),rs.getString("content")),r.get("id"));
   var bounded=new ArrayList<Fragment>();int remaining=6000;
   for(var c:chunks){if(remaining==0)break;String text=c.content().substring(0,Math.min(remaining,c.content().length()));remaining-=text.length();bounded.add(new Fragment(c.id(),c.locator(),text));}
   if(bounded.isEmpty())throw new IdentityException(409,"WIKI_SOURCE_NOT_READY");
   return new Source(material,version,(UUID)r.get("id"),(Integer)r.get("generation"),(String)m.get("filename"),(Integer)m.get("version"),bounded);
 }
 @Transactional public Draft start(UUID actor,UUID tenant,UUID material,Start body){
   if(body==null||body.requestId()==null||body.versionId()==null||body.generation()==null||body.generation()<1)throw IdentityException.invalid();
   material(actor,tenant,material);
   db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","wiki-learning:"+tenant+":"+actor+":"+material);
   String fingerprint=IdentityService.hash(tenant+"\n"+material+"\n"+body.versionId()+"\n"+body.generation());
   UUID prior=identities.priorRequest(actor,body.requestId(),"WIKI_LEARN",fingerprint);if(prior!=null)return detail(actor,tenant,prior);
   var s=source(actor,tenant,material,body.versionId(),null);if(s.generation()!=body.generation())throw changed();
   // Serialize learning starts for the same owner/source, including requests with different keys.
   if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_learning_drafts w JOIN conversation_tasks t ON t.id=w.task_id WHERE w.tenant_id=? AND w.actor_id=? AND w.material_id=? AND t.status IN ('QUEUED','RUNNING','WAITING_CAPABILITY','PAUSED','WAITING_INPUT','RESULT_UNKNOWN'))",Boolean.class,tenant,actor,material)))throw new IdentityException(409,"WIKI_LEARNING_BUSY");
   var personal=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL' AND NOT archived",UUID.class,tenant,actor);if(personal.size()!=1)throw new IdentityException(409,"PERSONAL_WORKSPACE_REQUIRED");
   var task=conversations.submitClient(actor,tenant,null,personal.getFirst(),UUID.randomUUID(),"学习所选资料，生成本人核对的 Wiki 草稿，保留原文依据。只使用所选资料。","AGENT",null,List.of(new TaskOriginals.Selection(material,s.versionId())),"SELECTED");
   UUID id=UUID.randomUUID();UUID taskId=task.tasks().getFirst().id();
   db.update("INSERT INTO wiki_learning_drafts(id,tenant_id,actor_id,material_id,version_id,run_id,task_id,conversation_id) VALUES (?,?,?,?,?,?,?,?)",id,tenant,actor,material,s.versionId(),s.runId(),taskId,task.conversation().id());
   identities.remember(actor,body.requestId(),"WIKI_LEARN",fingerprint,id);audit.record(actor,tenant,"WIKI_LEARNING_SUBMIT",id,"SUCCESS");return detail(actor,tenant,id);
 }
 public boolean ownsTask(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_learning_drafts WHERE task_id=?)",Boolean.class,task));}
 /** Called only after the normal short-lived task capability has been authorized. */
 public Source context(ConversationService.Job job){
   var rows=db.queryForList("SELECT * FROM wiki_learning_drafts WHERE task_id=? AND tenant_id=? AND actor_id=?",job.id(),job.tenant(),job.actor());if(rows.isEmpty())throw missing();var row=rows.getFirst();
   var s=source(job.actor(),job.tenant(),(UUID)row.get("material_id"),(UUID)row.get("version_id"),(UUID)row.get("run_id"));
   var space=db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,s.materialId());
   db.update("INSERT INTO conversation_task_material_versions(tenant_id,workspace_id,task_id,attempt_id,material_id,version_id,run_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),space,job.id(),job.token(),s.materialId(),s.versionId(),s.runId());
   for(var c:s.fragments())db.update("INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.space(),job.id(),job.token(),c.id());
   return s;
 }
 public Article validate(String raw,Source source){
   try{
     var node=json.readTree(raw);if(!node.isObject()||node.size()!=4||!node.has("title")||!node.has("intro")||!node.has("content")||!node.has("evidence"))throw IdentityException.invalid();
     if(!node.get("title").isString()||!node.get("intro").isString()||!node.get("content").isString()||!node.get("evidence").isArray())throw IdentityException.invalid();
     for(var e:node.get("evidence")){if(!e.isObject()||e.size()!=2||!e.has("chunkId")||!e.has("quote")||!e.get("chunkId").isString()||!e.get("quote").isString())throw IdentityException.invalid();}
     var article=json.readValue(raw,Article.class);text(article.title(),80);text(article.intro(),250);text(article.content(),1500);
     if(article.evidence()==null||article.evidence().isEmpty()||article.evidence().size()>4)throw IdentityException.invalid();
     for(var e:article.evidence()){if(e==null||e.chunkId()==null)throw IdentityException.invalid();text(e.quote(),200);if(e.quote().length()<6||source.fragments().stream().noneMatch(c->c.id().equals(e.chunkId())&&c.content().contains(e.quote())))throw IdentityException.invalid();}
     return article;
   }catch(Exception error){throw new IdentityException(502,"WIKI_RESULT_INVALID");}
 }
 private void text(String value,int max){if(value==null||value.isBlank()||value.length()>max||value.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();}
 public void validateResult(ConversationService.Job job,AgentResult result){
   if(!ownsTask(job.id()))return;
   if(!"1.5".equals(result.contractVersion())||!"COMPLETE".equals(result.outcome())||!result.tools().isEmpty()||!result.artifacts().isEmpty()||result.webSources()==null||!result.webSources().isEmpty()||result.skills()==null||!result.skills().isEmpty()||!result.originalIds().isEmpty())throw new IdentityException(502,"WIKI_RESULT_INVALID");
   validate(result.text(),context(job));
 }
 @Transactional public Draft detail(UUID actor,UUID tenant,UUID id){
   identities.member(actor,tenant,false);
   var rows=db.queryForList("SELECT w.*,t.status,t.execution_class,t.model_name,t.reply FROM wiki_learning_drafts w JOIN conversation_tasks t ON t.id=w.task_id WHERE w.id=? AND w.tenant_id=? AND w.actor_id=? AND object_is_active('TASK',t.id)",id,tenant,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();
   var m=material(actor,tenant,(UUID)r.get("material_id"));
   // Reuse the complete private task/source/lifecycle guard; never expose another owner's raw output.
   var guarded=conversations.taskDetail(actor,tenant,(UUID)r.get("conversation_id"),(UUID)r.get("task_id"));
   if(guarded.tasks().stream().noneMatch(t->t.id().equals(r.get("task_id"))&&!t.sourcesUnavailable()))throw missing();
   String status=(String)r.get("status");Article article=null;
   try{var s=source(actor,tenant,(UUID)r.get("material_id"),(UUID)r.get("version_id"),(UUID)r.get("run_id"));if(status.equals("SUCCEEDED"))article=validate((String)r.get("reply"),s);}
   catch(IdentityException e){if(e.code.equals("WIKI_SOURCE_CHANGED")||e.code.equals("WIKI_SOURCE_NOT_READY"))status="SOURCE_CHANGED";else throw e;}
   return new Draft(id,tenant,(UUID)r.get("material_id"),(UUID)r.get("version_id"),(UUID)r.get("conversation_id"),(UUID)r.get("task_id"),(String)m.get("name"),db.queryForObject("SELECT number FROM material_versions WHERE id=?",Integer.class,r.get("version_id")),status,(String)r.get("execution_class"),(String)r.get("model_name"),article);
 }
 @Transactional public Page list(UUID actor,UUID tenant,int offset){
   if(offset<0||offset>100000)throw IdentityException.invalid();identities.member(actor,tenant,false);
   var ids=db.queryForList("SELECT w.id FROM wiki_learning_drafts w JOIN active_materials m ON m.id=w.material_id JOIN workspaces s ON s.id=m.workspace_id JOIN conversations c ON c.id=w.conversation_id WHERE w.tenant_id=? AND w.actor_id=? AND c.trashed_at IS NULL AND s.kind='SHARED' AND m.in_library AND object_is_active('TASK',w.task_id) AND (library_mask(?,w.tenant_id,'MATERIAL',m.id)&1)=1 ORDER BY w.created_at DESC,w.id LIMIT 21 OFFSET ?",UUID.class,tenant,actor,actor,offset);
   return new Page(ids.stream().limit(20).map(id->detail(actor,tenant,id)).toList(),ids.size()>20);
 }
}
