package com.dreamcore.workspace.knowledge;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Explicit publication on the source file's existing audience and maintenance authority. */
@Service
public class WikiArticleService {
 public record Publish(UUID requestId,int expectedRevision,boolean acknowledged,String title,String intro,String content) {}
 public record Change(UUID requestId,int expectedRevision,String action,String title,String intro,String content) {}
 public record Item(UUID id,UUID tenantId,UUID materialId,int revision,boolean archived,boolean sourceChanged,boolean canMaintain,String sourceName,UUID sourceVersionId,int sourceVersion,String executionClass,String modelName,WikiLearningService.Article article) {}
 public record Page(List<Item> items,boolean hasMore) {}
 public record Preparation(int expectedRevision,boolean canPublish) {}
 public record History(int revision,String action,UUID actorId,String createdAt,boolean sourceChanged,WikiLearningService.Article article) {}
 public record HistoryPage(List<History> items,boolean hasMore) {}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final WikiLearningService learning;private final IdentityAudit audit;
 private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
 public WikiArticleService(JdbcTemplate db,IdentityService identities,MaterialAccess access,WikiLearningService learning,IdentityAudit audit){this.db=db;this.identities=identities;this.access=access;this.learning=learning;this.audit=audit;}
 private IdentityException missing(){return new IdentityException(404,"MATERIAL_NOT_FOUND");}
 private void lock(UUID tenant,UUID material){db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","wiki-article:"+tenant+":"+material);}
 private Map<String,Object> source(UUID actor,UUID tenant,UUID material,boolean write){
   identities.member(actor,tenant,false);
   var rows=db.queryForList("SELECT m.id,m.workspace_id,m.name FROM active_materials m JOIN workspaces s ON s.id=m.workspace_id AND s.tenant_id=m.tenant_id WHERE m.id=? AND m.tenant_id=? AND s.kind='SHARED' AND m.in_library",material,tenant);if(rows.isEmpty())throw missing();
   var row=rows.getFirst();access.requireObject(actor,tenant,(UUID)row.get("workspace_id"),"MATERIAL",material,write);return row;
 }
 private Map<String,Object> row(UUID actor,UUID tenant,UUID id,boolean write){
   identities.member(actor,tenant,false);var heads=db.queryForList("SELECT material_id FROM wiki_articles WHERE id=? AND tenant_id=?",id,tenant);if(heads.isEmpty())throw missing();UUID material=(UUID)heads.getFirst().get("material_id");
   source(actor,tenant,material,write);if(write)lock(tenant,material);
   var rows=db.queryForList("SELECT a.*,v.source_version_id,v.source_run_id,v.draft_id,v.article::text,v.execution_class,v.model_name,m.number source_version FROM wiki_articles a JOIN wiki_article_versions v ON v.article_id=a.id AND v.revision=a.revision JOIN material_versions m ON m.id=v.source_version_id WHERE a.id=? AND a.tenant_id=?",id,tenant);
   if(rows.isEmpty())throw missing();return rows.getFirst();
 }
 private WikiLearningService.Source fresh(UUID actor,UUID tenant,Map<String,Object> r){return learning.source(actor,tenant,(UUID)r.get("material_id"),(UUID)r.get("source_version_id"),(UUID)r.get("source_run_id"));}
 private WikiLearningService.Article parsed(Map<String,Object> row){if(row.get("article")==null)throw missing();return json.readValue(row.get("article").toString(),WikiLearningService.Article.class);}
 @Transactional public Preparation prepare(UUID actor,UUID tenant,UUID draft){
   var d=learning.detail(actor,tenant,draft);var s=source(actor,tenant,d.materialId(),false);
   int revision=db.queryForObject("SELECT coalesce((SELECT revision FROM wiki_articles WHERE tenant_id=? AND material_id=?),0)",Integer.class,tenant,d.materialId());
   boolean write=access.requireObject(actor,tenant,(UUID)s.get("workspace_id"),"MATERIAL",d.materialId(),false).canMaintain();
   return new Preparation(revision,write&&"SUCCEEDED".equals(d.status())&&d.article()!=null);
 }
 @Transactional public Item publish(UUID actor,UUID tenant,UUID draft,Publish body){
   if(body==null||body.requestId()==null||body.expectedRevision()<0||!body.acknowledged())throw IdentityException.invalid();
   var d=learning.detail(actor,tenant,draft);source(actor,tenant,d.materialId(),true);lock(tenant,d.materialId());
   String fingerprint=IdentityService.hash(tenant+"\n"+draft+"\n"+json.writeValueAsString(body));UUID prior=identities.priorRequest(actor,body.requestId(),"WIKI_PUBLISH",fingerprint);if(prior!=null)return detail(actor,tenant,prior);
   if(!"SUCCEEDED".equals(d.status())||d.article()==null)throw new IdentityException(409,"WIKI_SOURCE_CHANGED");
   var origin=db.queryForMap("SELECT run_id FROM wiki_learning_drafts WHERE id=?",draft);
   var bounded=learning.source(actor,tenant,d.materialId(),d.versionId(),(UUID)origin.get("run_id"));
   var article=validate(body.title(),body.intro(),body.content(),d.article().evidence(),bounded);
   var existing=db.queryForList("SELECT id,revision FROM wiki_articles WHERE tenant_id=? AND material_id=?",tenant,d.materialId());int current=existing.isEmpty()?0:(Integer)existing.getFirst().get("revision");
   if(current!=body.expectedRevision())throw new IdentityException(409,"WIKI_REVISION_CONFLICT");
   UUID id=existing.isEmpty()?UUID.randomUUID():(UUID)existing.getFirst().get("id");int revision=current+1;
   if(existing.isEmpty())db.update("INSERT INTO wiki_articles(id,tenant_id,material_id,revision) VALUES (?,?,?,?)",id,tenant,d.materialId(),revision);
   else db.update("UPDATE wiki_articles SET revision=?,archived=false,updated_at=now() WHERE id=?",revision,id);
   version(id,revision,d.versionId(),bounded.runId(),draft,article,d.executionClass(),d.modelName(),"PUBLISH",actor);
   identities.remember(actor,body.requestId(),"WIKI_PUBLISH",fingerprint,id);audit.record(actor,tenant,"WIKI_PUBLISH",id,"SUCCESS");return detail(actor,tenant,id);
 }
 private WikiLearningService.Article validate(String title,String intro,String content,List<WikiLearningService.Evidence> evidence,WikiLearningService.Source source){
   try{return learning.validate(json.writeValueAsString(new WikiLearningService.Article(title,intro,content,evidence)),source);}catch(IdentityException e){throw IdentityException.invalid();}
 }
 private void version(UUID id,int revision,UUID source,UUID run,UUID draft,WikiLearningService.Article article,String execution,String model,String action,UUID actor){
   db.update("INSERT INTO wiki_article_versions(article_id,revision,source_version_id,source_run_id,draft_id,article,execution_class,model_name,action,actor_id) VALUES (?,?,?,?,?,?::jsonb,?,?,?,?)",id,revision,source,run,draft,json.writeValueAsString(article),execution,model,action,actor);
 }
 @Transactional public Item change(UUID actor,UUID tenant,UUID id,Change body){
   if(body==null||body.requestId()==null||body.expectedRevision()<1||body.action()==null||!Set.of("EDIT","ARCHIVE","RESTORE").contains(body.action()))throw IdentityException.invalid();
   var r=row(actor,tenant,id,true);String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+json.writeValueAsString(body));UUID prior=identities.priorRequest(actor,body.requestId(),"WIKI_CHANGE",fingerprint);if(prior!=null)return detail(actor,tenant,id);
   int revision=(Integer)r.get("revision");if(revision!=body.expectedRevision())throw new IdentityException(409,"WIKI_REVISION_CONFLICT");
   boolean archived=(Boolean)r.get("archived");String action=body.action();
   if(action.equals("RESTORE")&&!archived || action.equals("ARCHIVE")&&archived || action.equals("EDIT")&&archived)throw new IdentityException(409,"WIKI_REVISION_CONFLICT");
   if(!action.equals("EDIT")&&(body.title()!=null||body.intro()!=null||body.content()!=null))throw IdentityException.invalid();
   var article=parsed(r);
   if(!action.equals("ARCHIVE")){var current=fresh(actor,tenant,r);if(action.equals("EDIT"))article=validate(body.title(),body.intro(),body.content(),article.evidence(),current);}
   else if(body.title()!=null||body.intro()!=null||body.content()!=null)throw IdentityException.invalid();
   version(id,revision+1,(UUID)r.get("source_version_id"),(UUID)r.get("source_run_id"),(UUID)r.get("draft_id"),article,(String)r.get("execution_class"),(String)r.get("model_name"),action,actor);
   db.update("UPDATE wiki_articles SET revision=?,archived=?,updated_at=now() WHERE id=?",revision+1,action.equals("ARCHIVE"),id);
   identities.remember(actor,body.requestId(),"WIKI_CHANGE",fingerprint,id);audit.record(actor,tenant,"WIKI_"+action,id,"SUCCESS");return detail(actor,tenant,id);
 }
 @Transactional public Item detail(UUID actor,UUID tenant,UUID id){
   var r=row(actor,tenant,id,false);UUID material=(UUID)r.get("material_id");var s=source(actor,tenant,material,false);boolean maintain=access.requireObject(actor,tenant,(UUID)s.get("workspace_id"),"MATERIAL",material,false).canMaintain();
   boolean archived=(Boolean)r.get("archived");if(archived&&!maintain)throw missing();boolean changed=false;
   try{fresh(actor,tenant,r);}catch(IdentityException e){if(Set.of("WIKI_SOURCE_CHANGED","WIKI_SOURCE_NOT_READY").contains(e.code))changed=true;else throw e;}
   return new Item(id,tenant,material,(Integer)r.get("revision"),archived,changed,maintain,(String)s.get("name"),(UUID)r.get("source_version_id"),(Integer)r.get("source_version"),(String)r.get("execution_class"),(String)r.get("model_name"),changed?null:parsed(r));
 }
 @Transactional public Page list(UUID actor,UUID tenant,boolean archived,int offset){
   if(offset<0||offset>100000)throw IdentityException.invalid();identities.member(actor,tenant,false);
   var ids=db.queryForList("SELECT a.id FROM wiki_articles a JOIN active_materials m ON m.id=a.material_id JOIN workspaces s ON s.id=m.workspace_id WHERE a.tenant_id=? AND a.archived=? AND m.in_library AND s.kind='SHARED' AND (library_mask(?,a.tenant_id,'MATERIAL',m.id)&?)=? ORDER BY a.updated_at DESC,a.id LIMIT 21 OFFSET ?",UUID.class,tenant,archived,actor,archived?3:1,archived?3:1,offset);
   return new Page(ids.stream().limit(20).map(id->detail(actor,tenant,id)).toList(),ids.size()>20);
 }
 @Transactional public HistoryPage history(UUID actor,UUID tenant,UUID id,int offset){
   if(offset<0||offset>100000)throw IdentityException.invalid();var head=row(actor,tenant,id,true);
   var rows=db.queryForList("SELECT revision,action,actor_id,created_at,source_version_id,source_run_id,article::text FROM wiki_article_versions WHERE article_id=? ORDER BY revision DESC LIMIT 21 OFFSET ?",id,offset);
   var items=new ArrayList<History>();for(var r:rows.stream().limit(20).toList()){
     boolean changed=false;try{learning.source(actor,tenant,(UUID)head.get("material_id"),(UUID)r.get("source_version_id"),(UUID)r.get("source_run_id"));}catch(IdentityException e){if(Set.of("WIKI_SOURCE_CHANGED","WIKI_SOURCE_NOT_READY").contains(e.code))changed=true;else throw e;}
     items.add(new History((Integer)r.get("revision"),(String)r.get("action"),(UUID)r.get("actor_id"),r.get("created_at").toString(),changed,changed||r.get("article")==null?null:parsed(r)));
   }return new HistoryPage(items,rows.size()>20);
 }
}
