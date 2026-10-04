package com.dreamcore.workspace;
import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.collection.enabled=false"})
abstract class TaskDatasetFixture {
 @Autowired JdbcTemplate db;@Autowired TaskContextService contexts;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;
 @Autowired com.dreamcore.workspace.experience.ExperienceService experiences;
 @LocalServerPort int port;JsonMapper json=new JsonMapper();UUID tenant,owner,space,privateSpace,connection,dataset,snapshot;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();space=UUID.randomUUID();privateSpace=UUID.randomUUID();connection=UUID.randomUUID();dataset=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成数据任务企业')",tenant);
  db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成数据使用者','not-a-login')",owner,owner+"@dataset.test");
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'获权销售空间','SHARED'),(?,?,?,'私人会话空间','PERSONAL')",space,tenant,owner,privateSpace,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,owner);
  db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,'合成外部系统','不得进入模型的部署路径','部署权限说明','READY','UTC')",connection,tenant);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'sales','销售数据',?::jsonb)",dataset,tenant,connection,space,json.writeValueAsString(columns()));
  snapshot=version(1,"旧版本");
 }
 List<String> columns(){return List.of("门店","数量");}
 List<List<String>> rowsFor(String marker){var rows=new ArrayList<List<String>>();for(int i=0;i<6;i++)rows.add(List.of(marker+i,""+i));return rows;}
 UUID version(int n,String marker){return version(n,rowsFor(marker));}
 UUID version(int n,List<?> rows){UUID id=UUID.randomUUID(),run=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,?,CAST(? AS jsonb),?,now())",id,tenant,connection,dataset,run,n,json.writeValueAsString(rows),rows.size());db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",id,dataset);return id;}
 @AfterEach void finishFixture(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 ConversationService.Job task(UUID conversation,String scope){var detail=conversations.submit(owner,tenant,conversation,privateSpace,UUID.randomUUID(),"分析获权销售数据，不发送或发布","AGENT");UUID id=detail.tasks().getLast().id();db.update("UPDATE conversation_tasks SET source_scope=? WHERE id=?",scope,id);return conversations.claim();}
 TaskContextService.Request request(String action,UUID id,UUID version,Integer offset){return new TaskContextService.Request(action,null,null,offset,id,version,null,null,null,null,null);}
 JsonNode call(ConversationService.Job t,TaskContextService.Request r){return json.valueToTree(contexts.context(t.id(),t.token(),r)).get("result");}
 void finish(ConversationService.Job t){agents.finish(t,new AgentResult("1.4","0.16.0",t.id(),t.token(),"AGENT","verification","synthetic-dataset","基于固定版本形成的合成结论",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));}
 void denied(Runnable action){assertThrows(IdentityException.class,action::run);}
}
