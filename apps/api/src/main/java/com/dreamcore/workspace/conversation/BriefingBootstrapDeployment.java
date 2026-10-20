package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.nio.file.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Host CLI only. External authoring never fabricates runtime model calls or usage. */
@Component
public class BriefingBootstrapDeployment {
 public record Card(String topic,DatasetCalculationService.Request calculation,BriefingContentService.Request content) {}
 public record Manifest(String contractVersion,UUID requestId,UUID tenantId,UUID ownerId,UUID workspaceId,List<Card> cards,boolean maintain) {
  public Manifest(String contractVersion,UUID requestId,UUID tenantId,UUID ownerId,UUID workspaceId,List<Card> cards){this(contractVersion,requestId,tenantId,ownerId,workspaceId,cards,false);}
 }
 private final JdbcTemplate db;private final TransactionTemplate tx;private final Environment env;private final MaterialAccess access;
 private final ConversationService conversations;private final DatasetCalculationService calculations;private final BriefingContentService briefings;private final IdentityAudit audit;
 @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.briefing.BriefingGenerationService generation;
 private final JsonMapper json=new JsonMapper();
 public BriefingBootstrapDeployment(JdbcTemplate db,TransactionTemplate tx,Environment env,MaterialAccess access,ConversationService conversations,DatasetCalculationService calculations,BriefingContentService briefings,IdentityAudit audit){this.db=db;this.tx=tx;this.env=env;this.access=access;this.conversations=conversations;this.calculations=calculations;this.briefings=briefings;this.audit=audit;}
 public void run()throws Exception{
  Path path=Path.of(env.getRequiredProperty("BRIEFING_BOOTSTRAP_FILE")),out=Path.of(env.getRequiredProperty("BRIEFING_BOOTSTRAP_RECEIPT"));
  if(!path.isAbsolute()||!out.isAbsolute()||!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)||Files.size(path)>262144||Files.exists(out,LinkOption.NOFOLLOW_LINKS)||!Files.isDirectory(out.getParent()))throw new IllegalArgumentException("Invalid private bootstrap file");
  var m=json.readValue(Files.readString(path),Manifest.class);boolean preview=env.getProperty("BRIEFING_BOOTSTRAP_PREVIEW",Boolean.class,true);
  Files.writeString(out,json.writeValueAsString(apply(m,preview)),StandardOpenOption.CREATE_NEW);
 }
 private void requireSource(Manifest m,Card card,boolean current){
  if(card==null||card.topic()==null||card.topic().isBlank()||card.topic().length()>300||card.calculation()==null)throw IdentityException.invalid();
  var p=card.calculation();var rows=db.queryForList("SELECT d.workspace_id,d.current_snapshot FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id WHERE d.tenant_id=? AND d.id=? AND s.id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed AND file_dataset_readable(?,d.id)",m.tenantId(),p.datasetId(),p.snapshotId(),m.ownerId());
  if(rows.size()!=1)throw new IdentityException(403,"BOOTSTRAP_SOURCE_NOT_GRANTED");
  access.require(m.ownerId(),m.tenantId(),(UUID)rows.getFirst().get("workspace_id"),false);
  if(current&&!p.snapshotId().equals(rows.getFirst().get("current_snapshot")))throw new IdentityException(409,"BOOTSTRAP_SOURCE_CHANGED");
 }
 public Map<String,Object> apply(Manifest m,boolean preview){
  if(m==null||!"1.0".equals(m.contractVersion())||m.requestId()==null||m.tenantId()==null||m.ownerId()==null||m.workspaceId()==null||m.cards()==null||m.cards().isEmpty()||m.cards().size()>20)throw IdentityException.invalid();
  return tx.execute(status->{
   access.require(m.ownerId(),m.tenantId(),m.workspaceId(),false);
   db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","briefing-bootstrap:"+m.tenantId()+":"+m.requestId());
   String digest=IdentityService.hash(json.writeValueAsString(m));
   for(var card:m.cards())requireSource(m,card,false);
   var prior=db.queryForList("SELECT owner_id,payload_sha256,receipt FROM briefing_bootstrap_receipts WHERE tenant_id=? AND request_id=?",m.tenantId(),m.requestId());
   if(!prior.isEmpty()){
    if(!m.ownerId().equals(prior.getFirst().get("owner_id"))||!digest.equals(prior.getFirst().get("payload_sha256")))throw new IdentityException(409,"BOOTSTRAP_REQUEST_CONFLICT");
    return json.readValue(prior.getFirst().get("receipt").toString(),Map.class);
   }
   var items=new ArrayList<Object>();
   for(var card:m.cards()){
    requireSource(m,card,true);
    UUID key=UUID.randomUUID();var detail=conversations.submitBriefing(m.ownerId(),m.tenantId(),m.workspaceId(),key,"Codex首轮画报："+card.topic(),null,List.of());
    UUID task=detail.tasks().getLast().id(),token=UUID.randomUUID();
    db.update("UPDATE conversation_tasks SET status='QUEUED',execution_class='external',wait_reason=NULL WHERE id=?",task);
    db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,started_at,provenance,execution_policy,allowed_tools) VALUES (?,1,?,?,'RUNNING',now(),'EXTERNAL_DEPLOYMENT','READ_ONLY_PRIVATE_V1','[\"compare_dataset\",\"deliver_briefing\"]')",task,token,card.topic());
    UUID policy=UUID.randomUUID();db.update("INSERT INTO briefing_generation_policies(id,tenant_id,workspace_id,owner_id,enabled) VALUES (?,?,?,?,false) ON CONFLICT(tenant_id,owner_id,workspace_id) DO NOTHING",policy,m.tenantId(),m.workspaceId(),m.ownerId());
    var pol=db.queryForMap("SELECT id,epoch FROM briefing_generation_policies WHERE tenant_id=? AND workspace_id=? AND owner_id=?",m.tenantId(),m.workspaceId(),m.ownerId());UUID batch=UUID.randomUUID();
    db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status,task_id,started_at) VALUES (?,?,?,?,?,?,'INITIALIZATION','DATA','RUNNING',?,now())",batch,m.tenantId(),m.ownerId(),m.workspaceId(),pol.get("id"),pol.get("epoch"),task);
    db.update("UPDATE briefing_generation_batches SET audience_key=work_audience_key(tenant_id,owner_id) WHERE id=?",batch);
    db.update("INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id) VALUES (?,?,?,?)",task,batch,card.calculation().datasetId(),card.calculation().snapshotId());
    db.update("UPDATE conversation_tasks SET status='RUNNING',attempt=1,revision=revision+1,lease_token=?,lease_until=now()+interval '10 minutes',wait_reason=NULL WHERE id=?",token,task);
    db.update("INSERT INTO task_dataset_reads(task_id,attempt_number,dataset_id,snapshot_id) VALUES (?,1,?,?)",task,card.calculation().datasetId(),card.calculation().snapshotId());
    var job=new ConversationService.Job(task,m.tenantId(),m.workspaceId(),detail.conversation().id(),m.ownerId(),card.topic(),token,"AGENT");
    // Pin only the manifest's explicit published metric; the governed calculator still validates the exact plan and grants.
    if(card.calculation().metricId()!=null&&card.calculation().metricVersion()!=null)
     com.dreamcore.workspace.scene.MetricCatalog.context(db,task,card.calculation().datasetId(),"",card.calculation().metricId(),card.calculation().metricVersion());
    start(task,1,"compare_dataset");var computed=calculations.calculate(job,card.calculation());done(task,1);
    var data=json.valueToTree(computed);var record=new LinkedHashMap<String,Object>();record.put("topic",card.topic());record.put("calculation",data);record.put("taskId",task);
    if(!preview){
     if(card.content()==null||!"DATA".equals(card.content().businessType())||card.content().calculationArtifactId()!=null)throw IdentityException.invalid();
     var c=card.content();var request=new BriefingContentService.Request(UUID.fromString(data.at("/artifact/id").asString()),c.title(),c.summary(),c.analysis(),"DATA",c.presentation());
     start(task,2,"deliver_briefing");var document=briefings.create(job,request);done(task,2);
     requireSource(m,card,true);
     String state=document==null?"NO_NEW_CONTENT":"SUCCEEDED";
     db.update("UPDATE conversation_tasks SET status='SUCCEEDED',revision=revision+1,reply=?,model_name='codex-external',model_calls=NULL,token_usage=NULL,engine_version='deployment-1',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",document==null?"与已有内容重复，未新增画报。":"Codex首轮画报已交付。",task);
     db.update("UPDATE briefing_generation_batches SET status=?,reason=?,finished_at=now() WHERE id=?",state,document==null?"DUPLICATE_CONTENT":null,batch);
     generation.seedBootstrapBaseline((UUID)pol.get("id"),batch,card.calculation().datasetId(),card.calculation().snapshotId(),m.maintain());
     conversations.archive(task);conversations.event(m.tenantId(),m.workspaceId(),detail.conversation().id(),task,"SUCCEEDED",db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,task));audit.record(m.ownerId(),m.tenantId(),"BRIEFING_EXTERNAL_DEPLOYMENT",task,"SUCCESS");
     if(document!=null)record.put("artifactId",document.artifactId());record.put("state",state);
    }
    if(preview)db.update("UPDATE briefing_generation_batches SET status='NO_NEW_CONTENT' WHERE id=?",batch);
    items.add(record);
   }
   var result=new LinkedHashMap<String,Object>();result.put("requestId",m.requestId());result.put("producer","Codex external deployment");result.put("runtimeModelUsage","NOT_APPLICABLE");result.put("preview",preview);result.put("items",items);
   if(preview)status.setRollbackOnly();else db.update("INSERT INTO briefing_bootstrap_receipts(tenant_id,request_id,owner_id,payload_sha256,receipt) VALUES (?,?,?,?,?::jsonb)",m.tenantId(),m.requestId(),m.ownerId(),digest,json.writeValueAsString(result));
   return result;
  });
 }
 private void start(UUID task,int sequence,String name){db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status,started_at) VALUES (?,1,?,?,'STARTED',clock_timestamp())",task,sequence,name);}
 private void done(UUID task,int sequence){db.update("UPDATE conversation_tool_receipts SET status='succeeded',received_at=clock_timestamp(),finished_at=clock_timestamp() WHERE task_id=? AND attempt_number=1 AND sequence=?",task,sequence);}
}
