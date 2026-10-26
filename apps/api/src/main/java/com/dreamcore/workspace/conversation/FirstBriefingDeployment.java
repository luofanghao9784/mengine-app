package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.audience.WorkAudienceService;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Two-step local adapter: the external author reads actual task evidence before delivery. */
@Component
public class FirstBriefingDeployment {
 public record Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content,String businessType,String objective,AgentTaskService.TopicSelection selection,DatasetCalculationService.Request calculation,NewsEvidence news,BriefingBusinessPlan.Request plan,Boolean authorizedLibrary) {
  public Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content,String businessType,String objective,AgentTaskService.TopicSelection selection,DatasetCalculationService.Request calculation,NewsEvidence news,BriefingBusinessPlan.Request plan){this(action,tenantId,actorId,workspaceId,storeId,dateFrom,dateTo,taskId,receiptId,content,businessType,objective,selection,calculation,news,plan,false);}
  public Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content,String businessType,String objective,AgentTaskService.TopicSelection selection,DatasetCalculationService.Request calculation,NewsEvidence news){this(action,tenantId,actorId,workspaceId,storeId,dateFrom,dateTo,taskId,receiptId,content,businessType,objective,selection,calculation,news,null);}
  public Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content,String businessType,String objective,AgentTaskService.TopicSelection selection,DatasetCalculationService.Request calculation){this(action,tenantId,actorId,workspaceId,storeId,dateFrom,dateTo,taskId,receiptId,content,businessType,objective,selection,calculation,null);}
  public Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content,String businessType,String objective,AgentTaskService.TopicSelection selection){this(action,tenantId,actorId,workspaceId,storeId,dateFrom,dateTo,taskId,receiptId,content,businessType,objective,selection,null);}
  public Input(String action,UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo,UUID taskId,String receiptId,BriefingContentService.Request content){this(action,tenantId,actorId,workspaceId,storeId,dateFrom,dateTo,taskId,receiptId,content,"SUGGESTION",null,null);}
 }
 public record NewsEvidence(UUID sourceId,List<String> discoveredUrls,List<AgentResult.WebSource> pages) {}
 @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.news.NewsSourceCatalog newsCatalog;
 private final JdbcTemplate db;private final ConversationService conversations;private final TaskContextService context;private final TaskContextGuard guard;private final MaterialAccess access;private final AgentTaskService agents;private final WorkAudienceService audience;
 private final JsonMapper json=new JsonMapper();
 public FirstBriefingDeployment(JdbcTemplate db,ConversationService conversations,TaskContextService context,TaskContextGuard guard,MaterialAccess access,AgentTaskService agents,WorkAudienceService audience){this.db=db;this.conversations=conversations;this.context=context;this.guard=guard;this.access=access;this.agents=agents;this.audience=audience;}
 @Transactional public Map<String,Object> execute(Input m){
  access.require(m.actorId(),m.tenantId(),m.workspaceId(),false);
  if("prepare".equals(m.action())){
   if(m.content()!=null||m.taskId()!=null)throw IdentityException.invalid();
   String type=Objects.requireNonNullElse(m.businessType(),"SUGGESTION");
   if(!Set.of("INFO","INSIGHT","SUGGESTION","RESULT","DATA").contains(type))throw new IdentityException(422,"FIRST_BRIEFING_TYPE_INVALID");
   String objective=Objects.requireNonNullElse(m.objective(),"核查门店收退款及待处理事项");
   if(objective.length()>500)throw IdentityException.invalid();
   var d=conversations.submitBriefing(m.actorId(),m.tenantId(),m.workspaceId(),UUID.randomUUID(),objective+"；要求画报类型："+type+"；不计算净收入利润",null,List.of());
   UUID task=d.tasks().getLast().id(),token=UUID.randomUUID();
   db.update("UPDATE conversation_tasks SET status='QUEUED',execution_class='verification',source_scope='WORKSPACE',wait_reason=NULL WHERE id=?",task);
   db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,started_at,provenance,execution_policy,allowed_tools) VALUES (?,1,?,'依据任务实际读取内容制作首轮画报','RUNNING',now(),'EXTERNAL_DEPLOYMENT','READ_ONLY_PRIVATE_V1','[\"task_context\",\"select_briefing_topic\",\"deliver_briefing\"]')",task,token);
   db.update("UPDATE conversation_tasks SET status='RUNNING',attempt=1,revision=revision+1,lease_token=?,lease_until=now()+interval '60 minutes',wait_reason=NULL WHERE id=?",token,task);
   db.update("UPDATE conversation_attempts SET input=? WHERE task_id=? AND attempt_number=1",json.writeValueAsString(Map.of("businessType",type,"objective",objective,"contract",BriefingGenerationContract.value())),task);
   if("DATA".equals(type))db.update("UPDATE conversation_attempts SET allowed_tools=?::jsonb WHERE task_id=?", "[\"task_context\",\"select_briefing_topic\",\"compare_dataset\",\"deliver_briefing\"]",task);
   if(Boolean.TRUE.equals(m.authorizedLibrary())||m.plan()!=null||m.storeId()!=null&&m.storeId().startsWith("chain-"))db.update("UPDATE conversation_tasks SET source_scope='AUTHORIZED_LIBRARY' WHERE id=?",task);
   var role=audience.task(task);
   if(m.plan()!=null)BriefingBusinessPlan.resolve(m.plan());
   var catalog=context.context(task,token,new TaskContextService.Request("reconciliation_catalog",null,null,null,null,null,null,null,null,null,null));
   return Map.of("taskId",task,"audience",role,"catalog",catalog,"state","AWAITING_TOPIC_SELECTION","runtimeModelUsage","NOT_APPLICABLE","generationContract",BriefingGenerationContract.value());
  }
  if(!Set.of("select","evidence","plan","read","calculate","news","deliver").contains(m.action())||m.taskId()==null)throw IdentityException.invalid();
  var rows=db.queryForList("SELECT t.lease_token,a.input FROM conversation_tasks t JOIN conversation_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt WHERE t.id=? AND t.tenant_id=? AND t.requested_by=? AND t.workspace_id=? AND t.status='RUNNING' AND t.execution_class='verification' AND a.provenance='EXTERNAL_DEPLOYMENT' FOR UPDATE OF t",m.taskId(),m.tenantId(),m.actorId(),m.workspaceId());
  if(rows.size()!=1)throw new IdentityException(409,"FIRST_BRIEFING_TASK_UNAVAILABLE");
  UUID token=(UUID)rows.getFirst().get("lease_token");
  if(!"select".equals(m.action())&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_editorial_tasks WHERE task_id=?)",Boolean.class,m.taskId())))throw new IdentityException(422,"BRIEFING_EDITORIAL_PLAN_REQUIRED");
  if("evidence".equals(m.action())){
   int seq=nextSequence(m.taskId());tool(m.taskId(),seq,"task_context");
   var evidence=context.context(m.taskId(),token,new TaskContextService.Request("reconciliation_execute",null,null,null,null,null,null,null,null,null,null,null,null,m.storeId(),m.dateFrom(),m.dateTo()));
   done(m.taskId(),seq);guard.requireCurrent(m.taskId());return Map.of("taskId",m.taskId(),"evidence",evidence);
  }
  if("news".equals(m.action())){
   var source=newsCatalog.selectedSources(m.tenantId()).stream().filter(x->m.news()!=null&&x.id().equals(m.news().sourceId())).findFirst().orElseThrow(()->new IdentityException(403,"NEWS_SOURCE_NOT_SELECTED"));
   validateNews(source.url(),m.news());
   var spec=json.readTree((String)rows.getFirst().get("input"));
   if(!"INFO".equals(spec.path("businessType").asText()))throw IdentityException.invalid();
   guard.requireCurrent(m.taskId());audience.requireCurrent(m.taskId());
   for(var page:m.news().pages())if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM news_article_deliveries WHERE tenant_id=? AND owner_id=? AND url=? AND sha256=?)",Boolean.class,m.tenantId(),m.actorId(),page.url(),page.sha256())))throw new IdentityException(409,"NEWS_ARTICLE_ALREADY_DELIVERED");
   db.update("UPDATE conversation_attempts SET allowed_tools=?::jsonb WHERE task_id=? AND attempt_number=1", "[\"task_context\",\"public_search\",\"read_public_page\",\"select_briefing_topic\",\"deliver_briefing\"]",m.taskId());
   db.update("UPDATE conversation_tasks SET public_query=?,web_sources=?::jsonb WHERE id=?",source.url(),json.writeValueAsString(m.news().pages()),m.taskId());
   for(String name:List.of("public_search","read_public_page")){int seq=nextSequence(m.taskId());tool(m.taskId(),seq,name);done(m.taskId(),seq);}
   return Map.of("sourceId",source.id(),"pages",m.news().pages(),"provenance","EXTERNAL_DEPLOYMENT_SHARED_PUBLIC_READER");
  }
  if("plan".equals(m.action())){
   int seq=nextSequence(m.taskId());tool(m.taskId(),seq,"task_context");
   var value=context.context(m.taskId(),token,new TaskContextService.Request("briefing_plan",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,m.plan()));done(m.taskId(),seq);return value;
  }
  if("select".equals(m.action()))return agents.selectTopic(m.taskId(),token,m.selection());
  if("read".equals(m.action())){
   if(m.calculation()==null)throw IdentityException.invalid();
   int seq=nextSequence(m.taskId());tool(m.taskId(),seq,"task_context");
   var result=context.context(m.taskId(),token,new TaskContextService.Request("dataset_read",null,null,0,m.calculation().datasetId(),m.calculation().snapshotId(),null,null,null,null,null,0,10,null,null,null));
   done(m.taskId(),seq);return result;
  }
  if("calculate".equals(m.action())){
   guard.requireCurrent(m.taskId());audience.requireCurrent(m.taskId());
   int seq=nextSequence(m.taskId());tool(m.taskId(),seq,"compare_dataset");
   var result=agents.compareDataset(m.taskId(),token,m.calculation());done(m.taskId(),seq);return result;
  }
  if(m.content()==null||m.receiptId()==null)throw IdentityException.invalid();
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_topic_selections WHERE task_id=?)",Boolean.class,m.taskId())))throw new IdentityException(422,"BRIEFING_TOPIC_REQUIRED");
  var receipts=db.queryForList("SELECT body::text FROM task_reconciliation_receipts WHERE task_id=? AND attempt_number=1 AND receipt_id=?",String.class,m.taskId(),m.receiptId());
  if(receipts.size()!=1)throw new IdentityException(409,"FIRST_BRIEFING_EVIDENCE_CHANGED");
  var evidence=json.readTree(receipts.getFirst());
  if(evidence.path("background").isEmpty()||!evidence.path("knowledgeRead").asBoolean())throw new IdentityException(422,"FIRST_BRIEFING_BUSINESS_CONTEXT_REQUIRED");
  var specification=json.readTree((String)rows.getFirst().get("input"));
  if(!specification.path("businessType").asText().equals(m.content().businessType()))throw new IdentityException(422,"BRIEFING_TYPE_MISMATCH");
  if(!specification.path("contract").equals(BriefingGenerationContract.value()))throw new IdentityException(409,"BRIEFING_CONTRACT_CHANGED");
  if("INFO".equals(m.content().businessType())){
   String url=db.queryForObject("SELECT public_query FROM conversation_tasks WHERE id=?",String.class,m.taskId());
   if(url==null||newsCatalog.selectedSources(m.tenantId()).stream().noneMatch(x->x.url().equals(url))||!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tool_receipts WHERE task_id=? AND name='read_public_page' AND status='succeeded')",Boolean.class,m.taskId())))throw new IdentityException(422,"BRIEFING_NEWS_EVIDENCE_REQUIRED");
  }
  guard.requireCurrent(m.taskId());audience.requireCurrent(m.taskId());
  // Shared delivery validates computed claims against the actual calculation artifact.
  if(!"DATA".equals(m.content().businessType()))BriefingEditorialQuality.validate(m.content(),true,true,false);
  int seq=nextSequence(m.taskId());tool(m.taskId(),seq,"deliver_briefing");var result=agents.deliverBriefing(m.taskId(),token,m.content());done(m.taskId(),seq);
  guard.requireCurrent(m.taskId());audience.requireCurrent(m.taskId());
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='已依据实际背景、知识读取和三表计算回执交付首轮画报。',revision=revision+1,model_name='codex-external',model_calls=NULL,token_usage=NULL,engine_version='deployment-shared-1',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",m.taskId());
  if("INFO".equals(m.content().businessType()))for(var page:json.readTree(db.queryForObject("SELECT web_sources::text FROM conversation_tasks WHERE id=?",String.class,m.taskId())))db.update("INSERT INTO news_article_deliveries(tenant_id,owner_id,url,sha256,task_id,published_at,retrieved_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",m.tenantId(),m.actorId(),page.path("url").asText(),page.path("sha256").asText(),m.taskId(),java.sql.Timestamp.from(java.time.Instant.parse(page.path("publishedAt").asText())),java.sql.Timestamp.from(java.time.Instant.parse(page.path("retrievedAt").asText())));
  conversations.archive(m.taskId());
  return Map.of("taskId",m.taskId(),"delivery",result,"receiptId",m.receiptId(),"runtimeModelUsage","NOT_APPLICABLE");
 }
 /** Host-only receipt from the shared public reader, not an HTTP endpoint or a model-supplied tool result. */
 static void validateNews(String sourceUrl,NewsEvidence evidence){
  try{
   if(evidence==null||evidence.discoveredUrls()==null||evidence.discoveredUrls().size()>32||evidence.pages()==null||evidence.pages().isEmpty()||evidence.pages().size()>3)throw new IllegalArgumentException();
   String host=java.net.URI.create(sourceUrl).getHost();var now=java.time.Instant.now();var ids=new HashSet<UUID>();
   for(var page:evidence.pages()){
    String url=com.dreamcore.workspace.news.NewsSourceCatalog.validateUrl(page.url());
    if(!host.equals(java.net.URI.create(url).getHost())||!evidence.discoveredUrls().contains(url)||!"PAGE".equals(page.kind())||page.id()==null||!ids.add(page.id())||page.title()==null||page.title().length()>160||page.excerpt()==null||page.excerpt().length()<40||page.excerpt().length()>4000||!IdentityService.hash(page.excerpt()).equals(page.sha256())||page.retrievedAt()==null||page.retrievedAt().isAfter(now.plusSeconds(60))||page.retrievedAt().isBefore(now.minusSeconds(86400))||page.publishedAt()==null||page.publishedAt().isAfter(now.plusSeconds(86400))||page.publishedAt().isBefore(now.minusSeconds(30L*86400))||page.image()!=null&&!NewsImage.valid(page.image()))throw new IllegalArgumentException();
   }
  }catch(RuntimeException e){throw new IdentityException(422,"FIRST_NEWS_EVIDENCE_INVALID");}
 }
 private int nextSequence(UUID id){return db.queryForObject("SELECT coalesce(max(sequence),0)+1 FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=1",Integer.class,id);}
 private void tool(UUID id,int seq,String name){db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status,started_at) VALUES (?,1,?,?,'STARTED',now())",id,seq,name);}
 private void done(UUID id,int seq){db.update("UPDATE conversation_tool_receipts SET status='succeeded',received_at=now(),finished_at=now() WHERE task_id=? AND sequence=?",id,seq);}
}
