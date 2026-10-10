package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.support.*;
import java.net.*;import java.net.http.*;import java.util.*;
import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000","dreamcore.knowledge.enabled=true","dreamcore.phone.delivery=local","dreamcore.phone.local-preview=true"})
class HeadquartersSupportIntegrationTest {
 @LocalServerPort int port;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;@Autowired SupportAccess access;@Autowired com.dreamcore.workspace.knowledge.KnowledgeService knowledge;@Autowired IdentityService identities;
 static final JsonMapper JSON=new JsonMapper();UUID hq,owner,employee,tenant,other,shared,privateSpace,ownerPrivate;String login;
 final class Browser {
  final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
  String token;
  HttpResponse<String> call(String method,String path,Object body,String csrf)throws Exception{
   var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");if(csrf!=null)b.header("X-CSRF-TOKEN",csrf);
   return http.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
  }
  String csrf(String prefix)throws Exception{return JSON.readTree(call("GET",prefix+"/csrf",null,null).body()).get("token").asString();}
  String enter(String mode)throws Exception{var r=call("POST","/api/platform-admin/v1/support-access",Map.of("tenant",tenant,"mode",mode),token);assertEquals(200,r.statusCode(),r.body());return JSON.readTree(r.body()).get("id").asString();}
 }
 UUID account(String name){UUID id=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test",name,passwords.encode("synthetic-123"));return id;}
 @BeforeEach void fixture(){
  hq=account("合成总部" );owner=account("合成负责人");employee=account("合成员工");tenant=UUID.randomUUID();other=UUID.randomUUID();shared=UUID.randomUUID();privateSpace=UUID.randomUUID();ownerPrivate=UUID.randomUUID();login=hq+"@example.test";
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",hq,login,passwords.encode("synthetic-hq-123"));db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",hq);
  for(UUID t:List.of(tenant,other)){db.update("INSERT INTO tenants(id,name) VALUES (?,?)",t,"合成支持企业");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",t,owner);db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",t,owner);}
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,employee);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享合成空间','SHARED')",shared,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,shared,owner);
  for(var pair:List.of(new UUID[]{privateSpace,employee},new UUID[]{ownerPrivate,owner}))db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成个人空间','PERSONAL')",pair[0],tenant,pair[1]);
 }
 @AfterEach void cleanup(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);db.update("DELETE FROM platform_sessions WHERE account_id=?",hq);db.update("DELETE FROM platform_roles WHERE account_id=?",hq);db.update("DELETE FROM platform_accounts WHERE account_id=?",hq);SupportContext.set(null);}
 Browser login()throws Exception{var b=new Browser();var r=b.call("POST","/api/platform-admin/v1/auth/login",Map.of("username",login,"password","synthetic-hq-123"),b.csrf("/api/platform-admin/v1/auth"));assertEquals(200,r.statusCode(),r.body());b.token=b.csrf("/api/platform-admin/v1/auth");return b;}
 String proxy(String id,String suffix){return "/api/platform-admin/v1/support-access/"+id+suffix;}
 @Test void newsSelectionThroughSupportRetainsHeadquartersActorAndScope()throws Exception{
  UUID source=UUID.randomUUID();db.update("INSERT INTO news_sources(id,name,url,format,enabled,changed_by) VALUES (?,'合成资讯',?,'RSS',true,?)",source,"https://news.example.org/"+source,hq);
  var b=login();String id=b.enter("ADJUSTMENT"),root=proxy(id,"/api/v1/tenants/"+tenant+"/news-sources");
  assertEquals(200,b.call("GET",root,null,null).statusCode());
  assertEquals(403,b.call("POST",root,Map.of("sourceId",source,"revision",1,"enabled",true),null).statusCode());
  var selected=b.call("POST",root,Map.of("sourceId",source,"revision",1,"enabled",true),b.token);assertEquals(200,selected.statusCode(),selected.body());
  assertEquals(hq,db.queryForObject("SELECT changed_by FROM tenant_news_sources WHERE tenant_id=? AND source_id=?",UUID.class,tenant,source));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM headquarters_support_changes WHERE access_id=?::uuid AND table_name='tenant_news_sources'",Integer.class,id));
  assertEquals(403,b.call("GET",proxy(id,"/api/v1/tenants/"+other+"/news-sources"),null,null).statusCode());
 }
 @Test void scopedAccessKeepsActorPrivatePermissionsCsrfAuditAndCustomerSession()throws Exception{
  var b=login();var customer=new Browser();String customerToken=customer.csrf("/api/v1/auth");assertEquals(200,customer.call("POST","/api/v1/auth/login",Map.of("email",employee+"@example.test","password","synthetic-123"),customerToken).statusCode());
  String id=b.enter("TEST"),root=proxy(id,"/api/v1/tenants/"+tenant);
  var governance=b.call("GET",root+"/governance",null,null);assertEquals(200,governance.statusCode(),governance.body());assertFalse(JSON.readTree(governance.body()).get("owner").asBoolean());assertTrue(JSON.readTree(governance.body()).get("canConfigure").asBoolean());
  var context=b.call("GET",root+"/context",null,null);assertEquals(200,context.statusCode(),context.body());assertTrue(context.body().contains(shared.toString()));assertTrue(context.body().contains(ownerPrivate.toString()));assertFalse(context.body().contains(privateSpace.toString()));
  var processing=b.call("GET",root+"/knowledge/processing",null,null);assertEquals(200,processing.statusCode(),processing.body());
  assertFalse(SupportSecurity.allowed("/api/v1/tenants/"+other+"/knowledge/processing",tenant,"GET"));
  assertFalse(SupportSecurity.allowed("/api/v1/tenants/"+tenant+"/knowledge/processing",tenant,"POST"));
  assertFalse(SupportSecurity.allowed("/api/v1/tenants/"+tenant+"/knowledge/processing/other",tenant,"GET"));
  assertEquals(403,b.call("GET",proxy(id,"/api/v1/tenants/"+other+"/governance"),null,null).statusCode());
  assertEquals(404,b.call("GET",root+"/workspaces/"+privateSpace+"/library",null,null).statusCode());
  assertEquals(404,b.call("GET",root+"/profiles/PERSONAL/"+employee,null,null).statusCode());
  assertEquals(403,b.call("POST",root+"/governance/handover",Map.of(),b.token).statusCode());
  var body=Map.of("name","合成测试目录","requestId",UUID.randomUUID());String path=root+"/workspaces/"+shared+"/folders";
  assertEquals(403,b.call("POST",path,body,null).statusCode());
  var created=b.call("POST",path,body,b.token);assertEquals(201,created.statusCode(),created.body());String folder=JSON.readTree(created.body()).get("id").asString();
  var appointed=b.call("POST",root+"/governance/members/"+employee+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN"),b.token);assertEquals(200,appointed.statusCode(),appointed.body());
  assertEquals("TENANT_ADMIN",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,employee));
  assertEquals(hq,db.queryForObject("SELECT actor_id FROM identity_audit WHERE tenant_id=? AND action='GOVERNANCE_ROLE' ORDER BY id DESC LIMIT 1",UUID.class,tenant));
  assertEquals(hq,db.queryForObject("SELECT created_by FROM material_folders WHERE id=?",UUID.class,UUID.fromString(folder)));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE account_id=?",Integer.class,hq));assertEquals(owner,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
  var changes=db.queryForList("SELECT * FROM headquarters_support_changes WHERE access_id=? AND table_name='material_folders'",UUID.fromString(id));assertFalse(changes.isEmpty());assertFalse(changes.toString().contains("合成测试目录"));assertFalse(changes.toString().contains("password"));
  assertTrue(db.queryForObject("SELECT count(*) FROM headquarters_support_events WHERE access_id=? AND outcome='DENIED'",Integer.class,UUID.fromString(id))>=3);
  assertEquals(employee.toString(),JSON.readTree(customer.call("GET","/api/v1/me",null,null).body()).get("account").get("id").asString());
  // Platform cookie alone cannot access the ordinary customer API.
  var independent=login();assertEquals(403,independent.call("GET","/api/v1/tenants/"+tenant+"/governance",null,null).statusCode());assertEquals(403,independent.call("GET",root+"/governance",null,null).statusCode());
  assertEquals(204,b.call("DELETE","/api/platform-admin/v1/support-access/"+id,null,b.token).statusCode());assertEquals(403,b.call("GET",root+"/governance",null,null).statusCode());
 }
 @Test void revocationAndPausedEnterpriseDoNotBypassExecution()throws Exception{
  var b=login();String id=b.enter("ADJUSTMENT"),root=proxy(id,"/api/v1/tenants/"+tenant);
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);
  assertEquals(200,b.call("GET",root+"/governance",null,null).statusCode());
  assertEquals(409,b.call("POST",root+"/workspaces/"+shared+"/folders",Map.of("name","合成暂停测试","requestId",UUID.randomUUID()),b.token).statusCode());
  String admin=proxy(id,"/api/tenant-admin/v1/tenants/"+tenant);
  var info=b.call("GET",admin+"/workspaces/"+shared,null,null);assertEquals(200,info.statusCode(),info.body());
  long version=JSON.readTree(info.body()).get("version").asLong();
  assertEquals(200,b.call("POST",admin+"/workspaces/"+shared+"/settings",Map.of("name","合成配置修改","requestId",UUID.randomUUID(),"expectedVersion",version),b.token).statusCode());
  db.update("DELETE FROM platform_roles WHERE account_id=?",hq);assertEquals(401,b.call("GET",root+"/governance",null,null).statusCode());
 }
 @Test void testUploadDownloadsAndExactBackgroundAuthorityExpireTogether()throws Exception{
  var b=login();String id=b.enter("TEST"),root=proxy(id,"/api/v1/tenants/"+tenant),boundary="synthetic-"+UUID.randomUUID();
  String body="--"+boundary+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n"+JSON.writeValueAsString(Map.of("requestId",UUID.randomUUID()))+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic-support.txt\"\r\nContent-Type: text/plain\r\n\r\nSynthetic support fixture, no customer data.\r\n--"+boundary+"--\r\n";
  var uploaded=b.http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+root+"/workspaces/"+shared+"/materials")).header("Content-Type","multipart/form-data; boundary="+boundary).header("X-CSRF-TOKEN",b.token).POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
  assertEquals(201,uploaded.statusCode(),uploaded.body());var json=JSON.readTree(uploaded.body());String material=json.get("id").asString(),version=json.get("acceptedVersion").get("id").asString();
  var job=knowledge.claim();assertNotNull(job);assertEquals(hq,job.actor());
  assertNotNull(access.forObject(job.actor(),job.tenant(),"knowledge_runs",job.id()));assertNotNull(knowledge.input(job));assertNull(SupportContext.current());
  assertEquals(200,b.call("GET",root+"/workspaces/"+shared+"/materials/"+material+"/versions/"+version+"/download",null,null).statusCode());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM headquarters_support_changes c JOIN headquarters_support_access s ON s.id=c.access_id WHERE c.table_name='knowledge_runs' AND c.object_id=? AND c.operation='INSERT' AND s.mode='TEST'",Integer.class,job.id().toString()));
  db.update("UPDATE platform_sessions SET expires_at=now()-interval '1 second' WHERE account_id=?",hq);
  assertThrows(IdentityException.class,()->knowledge.input(job));assertNull(SupportContext.current());
  assertThrows(IdentityException.class,()->access.forObject(job.actor(),job.tenant(),"knowledge_runs",job.id()));
  assertEquals(403,b.call("GET",root+"/governance",null,null).statusCode());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM headquarters_support_events WHERE access_id=? AND action='INVALIDATED'",Integer.class,UUID.fromString(id)));
 }

 @Test void localInvitationLinkUsesSupportScopeAndAuditsActualActor()throws Exception{
  var b=login();String id=b.enter("ADJUSTMENT"),root=proxy(id,"/api/tenant-admin/v1/tenants/"+tenant);
  var invite=identities.invite(owner,tenant,UUID.randomUUID(),"+8619900012345");
  String path=root+"/invitations/"+invite.id()+"/local-link";
  assertEquals(403,b.call("GET","/api/v1/auth/phone/local-invitation/"+invite.id(),null,null).statusCode());
  var result=b.call("GET",path,null,null);assertEquals(200,result.statusCode());
  assertEquals("no-store",result.headers().firstValue("Cache-Control").orElse(""));
  assertTrue(JSON.readTree(result.body()).get("path").asString().matches("/workspace/#invite=[A-Za-z0-9_-]{43}"));
  var foreign=identities.invite(owner,other,UUID.randomUUID(),"+8619900012346");
  assertEquals(403,b.call("GET",root+"/invitations/"+foreign.id()+"/local-link",null,null).statusCode());
  assertEquals(403,b.call("GET",proxy(id,"/api/tenant-admin/v1/tenants/"+other+"/invitations/"+foreign.id()+"/local-link"),null,null).statusCode());
  db.update("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=?",invite.id());
  assertEquals(409,b.call("GET",path,null,null).statusCode());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE account_id=?",Integer.class,hq));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM headquarters_support_events WHERE access_id=? AND action=? AND outcome='SUCCESS'",Integer.class,UUID.fromString(id),"GET /api/tenant-admin/v1/tenants/"+tenant+"/invitations/"+invite.id()+"/local-link"));
  assertEquals(204,b.call("DELETE","/api/platform-admin/v1/support-access/"+id,null,b.token).statusCode());
  assertEquals(403,b.call("GET",path,null,null).statusCode());
 }

}
