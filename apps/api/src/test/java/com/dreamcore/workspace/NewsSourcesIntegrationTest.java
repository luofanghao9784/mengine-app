package com.dreamcore.workspace;
import com.dreamcore.workspace.news.*;
import com.dreamcore.workspace.briefing.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
@SpringBootTest(properties={"dreamcore.tasks.public-web-enabled=true","dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.knowledge.enabled=true","dreamcore.briefing.merge-seconds=0"})
class NewsSourcesIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired NewsSourceCatalog catalog;@Autowired BriefingGenerationService generation;
 @Autowired com.dreamcore.workspace.material.MaterialService materials;@Autowired com.dreamcore.workspace.knowledge.KnowledgeService knowledge;@Autowired com.dreamcore.workspace.conversation.ConversationService conversations;@Autowired com.dreamcore.workspace.conversation.AgentTaskService agents;
 UUID platform,actor,reader,tenant,other,space;
 @BeforeEach void init(){platform=UUID.randomUUID();actor=UUID.randomUUID();reader=UUID.randomUUID();tenant=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();
  for(UUID id:List.of(platform,actor,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES(?,?,'合成资讯账号','unused')",id,id+"@news.test");}
  db.update("INSERT INTO platform_roles(account_id,role) VALUES(?,'PLATFORM_ADMIN')",platform);
  for(UUID id:List.of(tenant,other))db.update("INSERT INTO tenants(id,name) VALUES(?,'合成资讯企业')",id);
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES(?,?,'TENANT_ADMIN')",tenant,actor);
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES(?,?,'MEMBER')",tenant,reader);
  db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对与本职工作相关的公开行业资讯',1,?)",tenant,actor,actor);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES(?,?,?,'合成资讯空间','PERSONAL')",space,tenant,actor);
 }
 NewsSourceCatalog.Source create(){return catalog.save(platform,new NewsSourceCatalog.Change(UUID.randomUUID(),0,"合成官方来源","https://publisher.example.org/"+UUID.randomUUID(),"PAGE","健身","中国",true));}
 @Test void enterpriseSourceScopeAndDisableFence(){var s=create();assertFalse(generation.state(actor,tenant).capabilities().get("INFO").available());catalog.select(actor,tenant,s.id(),s.revision(),true);assertFalse(generation.state(actor,tenant).capabilities().get("INFO").available());assertEquals(1,catalog.selectedSources(tenant).size());assertTrue(catalog.selected(other).isEmpty());
  assertEquals(403,assertThrows(IdentityException.class,()->catalog.select(reader,tenant,s.id(),1,true)).status);
  assertThrows(IdentityException.class,()->catalog.list(actor,other));assertThrows(IdentityException.class,()->catalog.save(actor,new NewsSourceCatalog.Change(null,0,"拒绝","https://x.example.org/","PAGE","","",true)));
  catalog.save(platform,new NewsSourceCatalog.Change(s.id(),1,s.name(),s.url(),s.format(),s.industry(),s.region(),false));assertFalse(generation.state(actor,tenant).capabilities().get("INFO").available());
  assertEquals("NEWS_SOURCE_CHANGED",assertThrows(IdentityException.class,()->catalog.select(actor,tenant,s.id(),1,true)).code);
 }
 @Test void unavailableRequestDoesNotReserveAndOldWaitIsTerminal(){
  assertEquals("BRIEFING_INFO_UNAVAILABLE",assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,UUID.randomUUID(),space,2,List.of("INFO","DATA"))).code);assertEquals(0,generation.state(actor,tenant).quota().reserved());
  UUID policy=UUID.randomUUID(),batch=UUID.randomUUID();db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id) VALUES(?,?,?,?)",policy,tenant,actor,space);
  db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status,reason) VALUES(?,?,?,?,?,1,'GENERATE_MORE','INFO','WAITING_DATA','NEWS_SOURCE_UNAVAILABLE')",batch,tenant,actor,space,policy);
  assertEquals(1,generation.state(actor,tenant).quota().reserved());generation.tick(policy);assertEquals("FAILED",generation.get(actor,tenant,batch).status());assertEquals(0,generation.state(actor,tenant).quota().reserved());assertNull(generation.get(actor,tenant,batch).taskId());
 }
 @Test void sourceRevocationFencesAnInflightNewsTask(){
  var source=create();catalog.select(actor,tenant,source.id(),1,true);
  var upload=materials.uploadReceipt(actor,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","context.txt","text/plain","合成健身业务背景 marker".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var parse=knowledge.claim();assertNotNull(parse);knowledge.finish(parse,new com.dreamcore.workspace.knowledge.DocumentParser.Result("synthetic","READY",List.of(),List.of(new com.dreamcore.workspace.knowledge.DocumentParser.Fragment("L1","合成健身业务背景 marker","TEXT"))));
  var detail=conversations.submitBriefing(actor,tenant,space,UUID.randomUUID(),"合成资讯",source.url(),List.of());UUID policy=UUID.randomUUID();db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id) VALUES(?,?,?,?)",policy,tenant,actor,space);db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status,task_id) VALUES(?,?,?,?,?,1,'GENERATE_MORE','INFO','RUNNING',?)",UUID.randomUUID(),tenant,actor,space,policy,detail.tasks().getLast().id());db.update("UPDATE briefing_generation_batches SET audience_key=work_audience_key(tenant_id,owner_id) WHERE task_id=?",detail.tasks().getLast().id());var job=conversations.claim();assertNotNull(job);assertTrue(agents.check(job.id(),job.token()).containsKey("newsSeen"));
  catalog.select(actor,tenant,source.id(),1,false);assertEquals("TASK_ACCESS_DENIED",assertThrows(IdentityException.class,()->agents.check(job.id(),job.token())).code);
  db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",job.id());
 }
 @Test void urlAndIdempotentCreate(){for(String u:List.of("http://site.example.org","https://127.0.0.1","https://host.internal/","https://user:secret@site.example.org/"))assertThrows(IdentityException.class,()->NewsSourceCatalog.validateUrl(u));UUID request=UUID.randomUUID();var c=new NewsSourceCatalog.Change(request,0,"合成订阅","https://publisher.example.org/"+request,"RSS","政策","中国",false);assertEquals(catalog.save(platform,c),catalog.save(platform,c));assertEquals(1,db.queryForObject("SELECT count(*) FROM news_source_changes WHERE source_id=?",Integer.class,request));}
}
