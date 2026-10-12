package com.dreamcore.workspace.knowledge;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WikiGraphService {
 public record Selection(UUID articleId,int revision) {}
 public record Start(UUID requestId,List<Selection> articles) {}
 public record Node(UUID id,int revision,String title,String content) {}
 public record Evidence(UUID articleId,String quote) {}
 public record Relation(UUID from,UUID to,String kind,String reason,List<Evidence> evidence) {}
 public record Graph(List<UUID> selected,List<Relation> relations) {}
 public record Context(List<Node> documents) {}
 public record Item(UUID id,UUID tenantId,UUID taskId,UUID conversationId,String status,String executionClass,String modelName,List<Node> documents,Graph graph) {}
 public record Page(List<Item> items,boolean hasMore) {}
 private final JdbcTemplate db;private final IdentityService identities;private final WikiArticleService articles;private final ConversationService conversations;private final IdentityAudit audit;private final TaskOriginals originals;
 private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
 public WikiGraphService(JdbcTemplate db,IdentityService identities,WikiArticleService articles,ConversationService conversations,IdentityAudit audit,TaskOriginals originals){this.db=db;this.identities=identities;this.articles=articles;this.conversations=conversations;this.audit=audit;this.originals=originals;}
 private IdentityException changed(){return new IdentityException(409,"WIKI_SOURCE_CHANGED");}
 private IdentityException missing(){return new IdentityException(404,"MATERIAL_NOT_FOUND");}
 private WikiArticleService.Item current(UUID actor,UUID tenant,Selection input){var item=articles.detail(actor,tenant,input.articleId());if(item.archived()||item.sourceChanged()||item.article()==null||item.revision()!=input.revision())throw changed();return item;}
 @Transactional public Item start(UUID actor,UUID tenant,Start body){return startBatch(actor,tenant,body,3);}
 private Item startBatch(UUID actor,UUID tenant,Start body,int maximum){
  if(body==null||body.requestId()==null||body.articles()==null||body.articles().isEmpty()||body.articles().size()>maximum||body.articles().stream().anyMatch(s->s==null||s.articleId()==null||s.revision()<1)||body.articles().stream().map(Selection::articleId).distinct().count()!=body.articles().size())throw IdentityException.invalid();
  identities.member(actor,tenant,false);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","wiki-graph:"+tenant+":"+actor);
  var selected=body.articles().stream().sorted(Comparator.comparing(s->s.articleId().toString())).toList();
  String fingerprint=IdentityService.hash(tenant+"\n"+json.writeValueAsString(selected));UUID prior=identities.priorRequest(actor,body.requestId(),"WIKI_GRAPH",fingerprint);if(prior!=null)return detail(actor,tenant,prior);
  var inputs=selected.stream().map(s->current(actor,tenant,s)).toList();
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_graphs g JOIN conversation_tasks t ON t.id=g.task_id WHERE g.tenant_id=? AND g.actor_id=? AND t.status IN ('QUEUED','RUNNING','WAITING_CAPABILITY','PAUSED','WAITING_INPUT','RESULT_UNKNOWN'))",Boolean.class,tenant,actor)))throw new IdentityException(409,"WIKI_LEARNING_BUSY");
  var spaces=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL' AND NOT archived",UUID.class,tenant,actor);if(spaces.size()!=1)throw new IdentityException(409,"PERSONAL_WORKSPACE_REQUIRED");
  var task=conversations.submitClient(actor,tenant,null,spaces.getFirst(),UUID.randomUUID(),"分析所选共享知识的关系，推荐共同阅读的知识并保留两端依据。仅本人可见，不修改来源或发布结果。","AGENT",null,inputs.stream().limit(3).map(i->new TaskOriginals.Selection(i.materialId(),i.sourceVersionId())).toList(),"SELECTED");
  originals.selectAnalysis(actor,tenant,spaces.getFirst(),task.tasks().getFirst().id(),inputs.stream().map(i->new TaskOriginals.Selection(i.materialId(),i.sourceVersionId())).toList());
  UUID id=UUID.randomUUID();db.update("INSERT INTO wiki_graphs(id,tenant_id,actor_id,task_id,conversation_id) VALUES (?,?,?,?,?)",id,tenant,actor,task.tasks().getFirst().id(),task.conversation().id());
  for(var s:selected)db.update("INSERT INTO wiki_graph_inputs VALUES (?,?,?)",id,s.articleId(),s.revision());
  identities.remember(actor,body.requestId(),"WIKI_GRAPH",fingerprint,id);audit.record(actor,tenant,"WIKI_GRAPH_SUBMIT",id,"SUCCESS");return detail(actor,tenant,id);
 }
 @Transactional public Item automatic(UUID actor,UUID tenant,UUID requestId){
  identities.member(actor,tenant,false);String fingerprint=IdentityService.hash(tenant+"/automatic-wiki-graph");UUID prior=identities.priorRequest(actor,requestId,"WIKI_GRAPH_AUTO",fingerprint);if(prior!=null)return detail(actor,tenant,prior);
  var candidates=db.query("SELECT a.id,a.revision FROM wiki_articles a JOIN wiki_article_versions v ON v.article_id=a.id AND v.revision=a.revision JOIN active_materials m ON m.id=a.material_id JOIN workspaces w ON w.id=m.workspace_id JOIN material_versions mv ON mv.material_id=m.id AND mv.number=m.current_version JOIN knowledge_runs r ON r.id=v.source_run_id AND r.version_id=mv.id WHERE a.tenant_id=? AND NOT a.archived AND v.article IS NOT NULL AND m.in_library AND w.kind='SHARED' AND mv.id=v.source_version_id AND r.status IN ('READY','PARTIAL') AND NOT EXISTS(SELECT 1 FROM knowledge_runs newer WHERE newer.version_id=mv.id AND newer.generation>r.generation) AND (library_mask(?,a.tenant_id,'MATERIAL',m.id)&1)=1 ORDER BY a.updated_at DESC,a.id LIMIT 12",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2)),tenant,actor);
  if(candidates.isEmpty())throw new IdentityException(409,"WIKI_NO_CANDIDATES");
  var result=startBatch(actor,tenant,new Start(UUID.randomUUID(),candidates),12);identities.remember(actor,requestId,"WIKI_GRAPH_AUTO",fingerprint,result.id());return result;
 }
 public boolean ownsTask(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_graphs WHERE task_id=?)",Boolean.class,task));}
 private List<Selection> inputs(UUID graph){return db.query("SELECT article_id,revision FROM wiki_graph_inputs WHERE graph_id=? ORDER BY article_id",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2)),graph);}
 private Context context(UUID actor,UUID tenant,UUID id){return new Context(inputs(id).stream().map(s->{var a=current(actor,tenant,s);return new Node(a.id(),a.revision(),a.article().title(),a.article().content());}).toList());}
 public Context context(ConversationService.Job job){var ids=db.queryForList("SELECT id FROM wiki_graphs WHERE task_id=? AND tenant_id=? AND actor_id=?",UUID.class,job.id(),job.tenant(),job.actor());if(ids.isEmpty())throw missing();return context(job.actor(),job.tenant(),ids.getFirst());}
 public Graph validate(String raw,Context context){
  try{
   var root=json.readTree(raw);if(!root.isObject()||root.size()!=2||!root.has("selected")||!root.has("relations"))throw changed();
   if(!root.get("selected").isArray()||!root.get("relations").isArray())throw changed();
   for(var r:root.get("relations")){if(!r.isObject()||r.size()!=5||!r.has("from")||!r.has("to")||!r.has("kind")||!r.has("reason")||!r.has("evidence")||!r.get("evidence").isArray()||!r.get("reason").isString()||!r.get("kind").isString()||!r.get("from").isString()||!r.get("to").isString())throw changed();for(var e:r.get("evidence"))if(!e.isObject()||e.size()!=2||!e.has("articleId")||!e.has("quote")||!e.get("quote").isString()||!e.get("articleId").isString())throw changed();}
   var graph=json.readValue(raw,Graph.class);var candidates=new HashMap<UUID,Node>();for(var n:context.documents())candidates.put(n.id(),n);
   if(graph.selected()==null||graph.selected().isEmpty()||graph.selected().size()>6||new HashSet<>(graph.selected()).size()!=graph.selected().size()||!candidates.keySet().containsAll(graph.selected())||graph.relations()==null||graph.relations().size()>4)throw changed();
   var pairs=new HashSet<String>();for(var r:graph.relations()){
    if(r==null||r.from()==null||r.to()==null||r.from().equals(r.to())||!graph.selected().containsAll(List.of(r.from(),r.to()))||!Set.of("topic","complement","dependency","sequence").contains(r.kind()==null?"":r.kind()))throw changed();
    text(r.reason(),120);String pair=java.util.stream.Stream.of(r.from(),r.to()).map(UUID::toString).sorted().reduce("",String::concat);if(!pairs.add(pair)||r.evidence()==null||r.evidence().size()<2||r.evidence().size()>6)throw changed();
    var cited=new HashSet<UUID>();for(var e:r.evidence()){if(e==null||e.articleId()==null||!List.of(r.from(),r.to()).contains(e.articleId()))throw changed();text(e.quote(),80);if(e.quote().length()<6||!candidates.get(e.articleId()).content().contains(e.quote()))throw changed();cited.add(e.articleId());}if(cited.size()!=2)throw changed();
   }return graph;
  }catch(Exception e){throw new IdentityException(502,"WIKI_RESULT_INVALID");}
 }
 private void text(String s,int max){if(s==null||s.isBlank()||s.length()>max||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw changed();}
 public void validateResult(ConversationService.Job job,AgentResult result){if(!ownsTask(job.id()))return;if(!"1.5".equals(result.contractVersion())||!"COMPLETE".equals(result.outcome())||!result.tools().isEmpty()||!result.artifacts().isEmpty()||!result.webSources().isEmpty()||!result.skills().isEmpty()||!result.originalIds().isEmpty()||!result.sourceIds().isEmpty())throw new IdentityException(502,"WIKI_RESULT_INVALID");validate(result.text(),context(job));}
 @Transactional public Item detail(UUID actor,UUID tenant,UUID id){
  identities.member(actor,tenant,false);var rows=db.queryForList("SELECT g.*,t.status,t.reply,t.execution_class,t.model_name FROM wiki_graphs g JOIN conversation_tasks t ON t.id=g.task_id JOIN conversations c ON c.id=g.conversation_id WHERE g.id=? AND g.tenant_id=? AND g.actor_id=? AND c.trashed_at IS NULL AND object_is_active('TASK',t.id)",id,tenant,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();
  Context context=null;String status=(String)r.get("status");Graph graph=null;
  try{context=context(actor,tenant,id);}catch(IdentityException e){if(e.status==409)status="SOURCE_CHANGED";else throw e;}
  if(context!=null){var guard=conversations.taskDetail(actor,tenant,(UUID)r.get("conversation_id"),(UUID)r.get("task_id"));if(guard.tasks().stream().noneMatch(t->t.id().equals(r.get("task_id"))&&!t.sourcesUnavailable()))status="SOURCE_CHANGED";if(status.equals("SUCCEEDED"))graph=validate((String)r.get("reply"),context);}
  return new Item(id,tenant,(UUID)r.get("task_id"),(UUID)r.get("conversation_id"),status,(String)r.get("execution_class"),(String)r.get("model_name"),status.equals("SOURCE_CHANGED")?List.of():context.documents(),graph);
 }
 @Transactional public Page list(UUID actor,UUID tenant,int offset){
  if(offset<0||offset>100000)throw IdentityException.invalid();identities.member(actor,tenant,false);
  var ids=db.queryForList("SELECT g.id FROM wiki_graphs g JOIN conversations c ON c.id=g.conversation_id WHERE g.tenant_id=? AND g.actor_id=? AND c.trashed_at IS NULL AND object_is_active('TASK',g.task_id) AND NOT EXISTS(SELECT 1 FROM wiki_graph_inputs i JOIN wiki_articles a ON a.id=i.article_id WHERE i.graph_id=g.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=a.material_id AND m.in_library AND (NOT a.archived OR (library_mask(g.actor_id,g.tenant_id,'MATERIAL',m.id)&3)=3) AND (library_mask(?,g.tenant_id,'MATERIAL',m.id)&1)=1)) ORDER BY g.created_at DESC,g.id LIMIT 21 OFFSET ?",UUID.class,tenant,actor,actor,offset);
  return new Page(ids.stream().limit(20).map(id->detail(actor,tenant,id)).toList(),ids.size()>20);
 }
}
