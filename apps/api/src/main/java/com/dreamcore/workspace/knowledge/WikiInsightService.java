package com.dreamcore.workspace.knowledge;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WikiInsightService {
 public record Selection(UUID materialId,UUID versionId,int generation) {}
 public record Start(UUID requestId,String mode,List<Selection> sources) {}
 public record Document(UUID id,UUID versionId,int version,String title,boolean anchor,List<WikiLearningService.Fragment> fragments) {}
 public record Context(String mode,List<Document> documents) {}
 public record Evidence(UUID materialId,UUID chunkId,String quote) {}
 public record Point(String text,List<Evidence> evidence) {}
 public record Node(UUID materialId,Point summary,List<Point> takeaways) {}
 public record Relation(UUID from,UUID to,String kind,String reason,List<Evidence> evidence) {}
 public record Recommendation(UUID document,UUID anchor,String reason,List<Evidence> evidence) {}
 public record Report(List<Node> nodes,Point synthesis,List<Relation> relations,List<Recommendation> recommendations) {}
 public record Item(UUID id,UUID tenantId,UUID conversationId,UUID taskId,String mode,String status,String executionClass,String modelName,List<Document> documents,Report report) {}
 public record Page(List<Item> items,boolean hasMore) {}
 private final JdbcTemplate db;private final IdentityService identities;private final WikiLearningService learning;private final ConversationService conversations;private final TaskOriginals originals;private final IdentityAudit audit;
 private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
 public WikiInsightService(JdbcTemplate db,IdentityService identities,WikiLearningService learning,ConversationService conversations,TaskOriginals originals,IdentityAudit audit){this.db=db;this.identities=identities;this.learning=learning;this.conversations=conversations;this.originals=originals;this.audit=audit;}
 private IdentityException missing(){return new IdentityException(404,"MATERIAL_NOT_FOUND");}
 private IdentityException changed(){return new IdentityException(409,"WIKI_SOURCE_CHANGED");}
 @Transactional public Item start(UUID actor,UUID tenant,Start body){
  if(body==null||body.requestId()==null||!Set.of("ANALYZE","GRAPH","RECOMMEND").contains(body.mode()==null?"":body.mode())||body.sources()==null||body.sources().isEmpty()||body.sources().size()>6||body.sources().stream().anyMatch(s->s==null||s.materialId()==null||s.versionId()==null||s.generation()<1)||body.sources().stream().map(Selection::materialId).distinct().count()!=body.sources().size())throw IdentityException.invalid();
  identities.member(actor,tenant,false);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","wiki-insight:"+tenant+":"+actor);
  var selected=body.sources().stream().sorted(Comparator.comparing(s->s.materialId().toString())).toList();String fp=IdentityService.hash(tenant+"\n"+body.mode()+"\n"+json.writeValueAsString(selected));var prior=identities.priorRequest(actor,body.requestId(),"WIKI_INSIGHT",fp);if(prior!=null)return detail(actor,tenant,prior);
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_insights i JOIN conversation_tasks t ON t.id=i.task_id WHERE i.tenant_id=? AND i.actor_id=? AND t.status IN ('QUEUED','RUNNING','WAITING_CAPABILITY','PAUSED','WAITING_INPUT','RESULT_UNKNOWN'))",Boolean.class,tenant,actor)))throw new IdentityException(409,"WIKI_LEARNING_BUSY");
  var sources=new ArrayList<WikiLearningService.Source>();for(var s:selected){var current=learning.source(actor,tenant,s.materialId(),s.versionId(),null);if(current.generation()!=s.generation())throw changed();sources.add(current);}
  int anchors=sources.size();
  if(body.mode().equals("RECOMMEND")){
   // Lexical shortlist is a deterministic candidate filter, never a claim of semantic relationship.
   String terms=String.join(" ",sources.stream().map(WikiLearningService.Source::filename).toList());
   var candidates=db.queryForList("SELECT m.id,v.id version_id FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version JOIN LATERAL(SELECT id,status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true WHERE m.tenant_id=? AND m.in_library AND w.kind='SHARED' AND r.status IN ('READY','PARTIAL') AND EXISTS(SELECT 1 FROM knowledge_chunks c WHERE c.run_id=r.id AND length(c.content)>0) AND (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1 AND NOT (m.id=ANY(?::uuid[])) ORDER BY CASE WHEN strpos(?,m.name)>0 THEN 1 ELSE 0 END DESC,m.id LIMIT 12",tenant,actor,"{"+String.join(",",selected.stream().map(s->s.materialId().toString()).toList())+"}",terms);
   for(var r:candidates)sources.add(learning.source(actor,tenant,(UUID)r.get("id"),(UUID)r.get("version_id"),null));
  }
  var spaces=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL' AND NOT archived",UUID.class,tenant,actor);if(spaces.size()!=1)throw new IdentityException(409,"PERSONAL_WORKSPACE_REQUIRED");
  var originalsList=sources.stream().map(s->new TaskOriginals.Selection(s.materialId(),s.versionId())).toList();
  var task=conversations.submitClient(actor,tenant,null,spaces.getFirst(),UUID.randomUUID(),"分析所选原资料的要点、综合结论或关联推荐，保留逐字原文依据。结果仅本人可见，不修改来源。","AGENT",null,originalsList.stream().limit(3).toList(),"SELECTED");UUID taskId=task.tasks().getFirst().id();originals.selectAnalysis(actor,tenant,spaces.getFirst(),taskId,originalsList);
  UUID id=UUID.randomUUID();db.update("INSERT INTO wiki_insights(id,tenant_id,actor_id,mode,task_id,conversation_id) VALUES (?,?,?,?,?,?)",id,tenant,actor,body.mode(),taskId,task.conversation().id());for(int i=0;i<sources.size();i++){var s=sources.get(i);db.update("INSERT INTO wiki_insight_inputs VALUES (?,?,?,?,?)",id,s.materialId(),s.versionId(),s.runId(),i<anchors);}
  identities.remember(actor,body.requestId(),"WIKI_INSIGHT",fp,id);audit.record(actor,tenant,"WIKI_INSIGHT_SUBMIT",id,"SUCCESS");return detail(actor,tenant,id);
 }
 public boolean ownsTask(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM wiki_insights WHERE task_id=?)",Boolean.class,task));}
 private Context context(UUID actor,UUID tenant,UUID id,String mode){
  var rows=db.queryForList("SELECT * FROM wiki_insight_inputs WHERE insight_id=? ORDER BY anchor DESC,material_id",id);var documents=new ArrayList<Document>();
  for(var r:rows){var s=learning.source(actor,tenant,(UUID)r.get("material_id"),(UUID)r.get("version_id"),(UUID)r.get("run_id"));int remaining=mode.equals("RECOMMEND")?1000:3000;var fragments=new ArrayList<WikiLearningService.Fragment>();for(var f:s.fragments()){if(remaining==0)break;String text=f.content().substring(0,Math.min(remaining,f.content().length()));remaining-=text.length();fragments.add(new WikiLearningService.Fragment(f.id(),f.locator(),text));if(mode.equals("RECOMMEND"))break;}documents.add(new Document(s.materialId(),s.versionId(),s.version(),s.filename(),(Boolean)r.get("anchor"),fragments));}
  return new Context(mode,documents);
 }
 public Context context(ConversationService.Job job){var rows=db.queryForList("SELECT id,mode FROM wiki_insights WHERE task_id=? AND tenant_id=? AND actor_id=?",job.id(),job.tenant(),job.actor());if(rows.isEmpty())throw missing();var row=rows.getFirst();return context(job.actor(),job.tenant(),(UUID)row.get("id"),(String)row.get("mode"));}
 private void text(String s,int limit){if(s==null||s.isBlank()||s.length()>limit||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=9&&c!=10&&c!=13))throw changed();}
 private void evidence(List<Evidence> list,Context context,Set<UUID> allowed,boolean all){if(list==null||list.isEmpty()||list.size()>6)throw changed();var covered=new HashSet<UUID>();for(var e:list){if(e==null||e.materialId()==null||e.chunkId()==null||!allowed.contains(e.materialId()))throw changed();text(e.quote(),200);if(e.quote().length()<6||context.documents().stream().filter(d->d.id().equals(e.materialId())).flatMap(d->d.fragments().stream()).noneMatch(f->f.id().equals(e.chunkId())&&f.content().contains(e.quote())))throw changed();covered.add(e.materialId());}if(all&&!covered.containsAll(allowed))throw changed();}
 private void point(Point p,int limit,Context context,Set<UUID> allowed,boolean all){if(p==null)throw changed();text(p.text(),limit);evidence(p.evidence(),context,allowed,all);}
 private void exact(tools.jackson.databind.JsonNode n,String... keys){if(n==null||!n.isObject()||n.size()!=keys.length)throw changed();for(String k:keys)if(!n.has(k))throw changed();}
 private void evidenceShape(tools.jackson.databind.JsonNode n){if(n==null||!n.isArray())throw changed();for(var e:n){exact(e,"materialId","chunkId","quote");if(!e.get("materialId").isString()||!e.get("chunkId").isString()||!e.get("quote").isString())throw changed();}}
 private void pointShape(tools.jackson.databind.JsonNode n){exact(n,"text","evidence");if(!n.get("text").isString())throw changed();evidenceShape(n.get("evidence"));}
 public Report validate(String raw,Context c){try{
  var tree=json.readTree(raw);if(!tree.isObject()||tree.size()!=4||!tree.has("nodes")||!tree.has("synthesis")||!tree.has("relations")||!tree.has("recommendations")||raw.length()>30000)throw changed();
  if(!tree.get("nodes").isArray()||!tree.get("relations").isArray()||!tree.get("recommendations").isArray())throw changed();
  for(var n:tree.get("nodes")){exact(n,"materialId","summary","takeaways");if(!n.get("materialId").isString()||!n.get("takeaways").isArray())throw changed();pointShape(n.get("summary"));for(var p:n.get("takeaways"))pointShape(p);}
  if(!tree.get("synthesis").isNull())pointShape(tree.get("synthesis"));
  for(var r:tree.get("relations")){exact(r,"from","to","kind","reason","evidence");for(String k:List.of("from","to","kind","reason"))if(!r.get(k).isString())throw changed();evidenceShape(r.get("evidence"));}
  for(var r:tree.get("recommendations")){exact(r,"document","anchor","reason","evidence");for(String k:List.of("document","anchor","reason"))if(!r.get(k).isString())throw changed();evidenceShape(r.get("evidence"));}
  var report=json.readValue(raw,Report.class);if(report.nodes()==null||report.relations()==null||report.recommendations()==null)throw changed();var ids=new HashSet<UUID>();var anchors=new HashSet<UUID>();for(var d:c.documents()){ids.add(d.id());if(d.anchor())anchors.add(d.id());}
  if(c.mode().equals("ANALYZE")){if(report.nodes().size()!=ids.size()||report.nodes().stream().map(Node::materialId).distinct().count()!=ids.size())throw changed();for(var n:report.nodes()){if(n==null||!ids.contains(n.materialId())||n.takeaways()==null||n.takeaways().isEmpty()||n.takeaways().size()>4)throw changed();point(n.summary(),700,c,Set.of(n.materialId()),true);for(var p:n.takeaways())point(p,240,c,Set.of(n.materialId()),true);}point(report.synthesis(),1600,c,ids,true);}else if(!report.nodes().isEmpty()||report.synthesis()!=null)throw changed();
  if(c.mode().equals("RECOMMEND")){if(!report.relations().isEmpty()||report.recommendations().size()>4)throw changed();var targets=new HashSet<UUID>();for(var r:report.recommendations()){if(r==null||!anchors.contains(r.anchor())||!ids.contains(r.document())||anchors.contains(r.document())||!targets.add(r.document()))throw changed();text(r.reason(),350);evidence(r.evidence(),c,Set.of(r.anchor(),r.document()),true);}}else{
   if(!report.recommendations().isEmpty()||report.relations().size()>8)throw changed();var pairs=new HashSet<String>();for(var r:report.relations()){if(r==null||r.from()==null||r.to()==null||r.from().equals(r.to())||!ids.containsAll(List.of(r.from(),r.to()))||!Set.of("topic","complement","dependency","sequence").contains(r.kind()==null?"":r.kind()))throw changed();var pair=java.util.stream.Stream.of(r.from(),r.to()).map(UUID::toString).sorted().reduce("",String::concat);if(!pairs.add(pair))throw changed();text(r.reason(),450);evidence(r.evidence(),c,Set.of(r.from(),r.to()),true);}
  }return report;
 }catch(Exception e){throw new IdentityException(502,"WIKI_RESULT_INVALID");}}
 public void validateResult(ConversationService.Job job,AgentResult r){if(!ownsTask(job.id()))return;if(!"1.5".equals(r.contractVersion())||!"COMPLETE".equals(r.outcome())||!r.tools().isEmpty()||!r.artifacts().isEmpty()||!r.webSources().isEmpty()||!r.skills().isEmpty()||!r.originalIds().isEmpty()||!r.sourceIds().isEmpty())throw new IdentityException(502,"WIKI_RESULT_INVALID");validate(r.text(),context(job));}
 @Transactional public Item detail(UUID actor,UUID tenant,UUID id){identities.member(actor,tenant,false);var rows=db.queryForList("SELECT i.*,t.status,t.reply,t.execution_class,t.model_name FROM wiki_insights i JOIN conversation_tasks t ON t.id=i.task_id JOIN conversations c ON c.id=i.conversation_id WHERE i.id=? AND i.tenant_id=? AND i.actor_id=? AND c.trashed_at IS NULL AND object_is_active('TASK',t.id)",id,tenant,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();String status=(String)r.get("status");Context context=null;Report report=null;try{context=context(actor,tenant,id,(String)r.get("mode"));}catch(IdentityException e){if(e.status==409)status="SOURCE_CHANGED";else throw e;}if(context!=null){var guard=conversations.taskDetail(actor,tenant,(UUID)r.get("conversation_id"),(UUID)r.get("task_id"));if(guard.tasks().stream().noneMatch(t->t.id().equals(r.get("task_id"))&&!t.sourcesUnavailable()))status="SOURCE_CHANGED";if(status.equals("SUCCEEDED"))report=validate((String)r.get("reply"),context);}return new Item(id,tenant,(UUID)r.get("conversation_id"),(UUID)r.get("task_id"),(String)r.get("mode"),status,(String)r.get("execution_class"),(String)r.get("model_name"),status.equals("SOURCE_CHANGED")?List.of():context.documents(),report);}
 @Transactional public Page list(UUID actor,UUID tenant,int offset){if(offset<0||offset>100000)throw IdentityException.invalid();identities.member(actor,tenant,false);var ids=db.queryForList("SELECT i.id FROM wiki_insights i JOIN conversations c ON c.id=i.conversation_id WHERE i.tenant_id=? AND i.actor_id=? AND c.trashed_at IS NULL AND object_is_active('TASK',i.task_id) AND NOT EXISTS(SELECT 1 FROM wiki_insight_inputs s WHERE s.insight_id=i.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=s.material_id AND m.in_library AND (library_mask(?,i.tenant_id,'MATERIAL',m.id)&1)=1)) ORDER BY i.created_at DESC,i.id LIMIT 21 OFFSET ?",UUID.class,tenant,actor,actor,offset);return new Page(ids.stream().limit(20).map(id->detail(actor,tenant,id)).toList(),ids.size()>20);}
}
