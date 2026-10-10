package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialService;
import java.util.*;import java.net.*;import java.net.http.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.mock.web.MockMultipartFile;import org.springframework.security.crypto.password.PasswordEncoder;import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.collection.enabled=false"})
class PlatformDataOperationsIntegrationTest {
 @Autowired PlatformDataOperationsService service;@Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,other,operator,member,space;String prefix;static final String SECRET="private-business-content-never-project",PASSWORD="synthetic-data-operations-password";
 @BeforeEach void setup(){tenant=UUID.randomUUID();other=UUID.randomUUID();operator=UUID.randomUUID();member=UUID.randomUUID();space=UUID.randomUUID();prefix="ops-"+tenant;
  for(UUID a:List.of(operator,member))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",a,a+"@example.test",SECRET,passwords.encode(PASSWORD));
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",operator,operator+"@example.test",passwords.encode(PASSWORD));
  db.update("INSERT INTO tenants(id,name) VALUES (?,?),(?,?)",tenant,prefix+"-A",other,prefix+"-B");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,member);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,'PERSONAL')",space,tenant,member,SECRET);
 }
 @AfterEach void cleanup(){db.update("DELETE FROM platform_sessions WHERE account_id=?",operator);db.update("DELETE FROM platform_accounts WHERE account_id=?",operator);db.update("DELETE FROM platform_roles WHERE account_id=?",operator);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE collection_runs SET status='INTERRUPTED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);}
 UUID connection(UUID t,String status){UUID c=UUID.randomUUID();db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,?,?,?,?,'UTC')",c,t,SECRET,SECRET,SECRET,status);return c;}
 UUID run(UUID t,UUID c,String state,int minutes){UUID r=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status,reason,created_at,finished_at) VALUES (?,?,?,0,'SCHEDULED',?,?,now()-make_interval(mins=>?),now()-make_interval(mins=>?))",r,t,c,state,SECRET,minutes,minutes);return r;}
 PlatformDataOperationsService.Detail detail(String kind){return service.detail(operator,tenant,kind,"ALL",0);}
 void denied(int status,Runnable work){assertEquals(status,assertThrows(IdentityException.class,work::run).status);}
 @Test void emptyTenantsAreNotPresentedAsHealthyProcessing(){var page=service.list(operator,"CONNECTIONS",prefix,"ALL",0);assertEquals(2,page.matchedTenants());assertEquals(0,page.counts().total());assertEquals(2,page.items().size());assertNull(page.items().getFirst().lastSuccessAt());assertEquals(0,service.list(operator,"CONNECTIONS",prefix,"READY",0).matchedTenants());}
 @Test void latestRunReplacesOldFailureButRetainsLastSuccessfulTimestamp(){UUID c=connection(tenant,"READY");run(tenant,c,"SUCCEEDED",10);run(tenant,c,"FAILED",5);UUID latest=run(tenant,c,"RUNNING",0);
  var first=detail("CONNECTIONS");assertEquals(1,first.counts().processing());assertEquals(0,first.counts().attention());assertEquals(latest,first.items().getFirst().runId());assertNotNull(first.items().getFirst().lastSuccessAt());assertNull(first.items().getFirst().diagnostic());
  db.update("UPDATE collection_runs SET status='FAILED' WHERE id=?",latest);var failure=detail("CONNECTIONS");assertEquals(1,failure.counts().attention());assertEquals("OTHER",failure.items().getFirst().diagnostic());
  UUID otherConnection=connection(other,"UNAVAILABLE");run(other,otherConnection,"FAILED",0);assertEquals(1,detail("CONNECTIONS").counts().total());
  var json=new JsonMapper().writeValueAsString(failure);for(String secret:List.of(SECRET,c.toString(),member.toString(),space.toString(),"routeLabel","accessSummary","name","warnings"))assertFalse(json.contains(secret),secret);
 }
 @Test void configurationAndRunStageStaySeparate(){connection(tenant,"UNCONFIGURED");UUID c=connection(tenant,"UNAVAILABLE");run(tenant,c,"SUCCEEDED",1);var d=detail("CONNECTIONS");assertEquals(1,d.counts().notStarted());assertEquals(1,d.counts().attention());var unavailable=d.items().stream().filter(i->"UNAVAILABLE".equals(i.configuration())).findFirst().orElseThrow();assertEquals("SUCCEEDED",unavailable.stage());assertEquals("CONNECTION_UNAVAILABLE",unavailable.diagnostic());}
 @Test void tenantFilterPrecedesPaginationAndTotalsDescribeSelectedTenants(){for(int i=0;i<22;i++){UUID t=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,?)",t,prefix+"-page-"+String.format("%02d",i));connection(t,i%2==0?"UNAVAILABLE":"UNCONFIGURED");}
  var first=service.list(operator,"CONNECTIONS",prefix+"-page-","ALL",0);assertEquals(22,first.matchedTenants());assertEquals(20,first.items().size());assertTrue(first.hasMore());assertEquals(22,first.counts().total());
  var second=service.list(operator,"CONNECTIONS",prefix+"-page-","ALL",20);assertEquals(2,second.items().size());assertFalse(second.hasMore());assertTrue(Collections.disjoint(first.items().stream().map(PlatformDataOperationsService.TenantRow::tenantId).toList(),second.items().stream().map(PlatformDataOperationsService.TenantRow::tenantId).toList()));
  var filtered=service.list(operator,"CONNECTIONS",prefix+"-page-","ATTENTION",0);assertEquals(11,filtered.matchedTenants());assertEquals(11,filtered.items().size());assertFalse(filtered.hasMore());assertEquals(11,filtered.counts().attention());assertEquals(0,service.list(operator,"CONNECTIONS","%"+prefix,"ALL",0).matchedTenants());
 }
 @Test void detailFilterPrecedesPagingWithoutLeakingConnectionIdentifiers(){for(int i=0;i<22;i++)connection(tenant,i<21?"UNAVAILABLE":"UNCONFIGURED");var first=service.detail(operator,tenant,"CONNECTIONS","ATTENTION",0);assertEquals(22,first.counts().total());assertEquals(20,first.items().size());assertTrue(first.hasMore());assertTrue(first.items().stream().allMatch(i->i.category().equals("ATTENTION")));assertEquals(1,service.detail(operator,tenant,"CONNECTIONS","ATTENTION",20).items().size());}
 @Test void materialProjectionUsesCurrentVersionAndLatestGenerationWithoutPrivateNames(){var m=materials.upload(member,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",SECRET+".txt","text/plain",SECRET.getBytes()));var initial=detail("MATERIALS");assertEquals(1,initial.counts().processing());UUID run=initial.items().getFirst().runId();assertNotNull(run);
  db.update("UPDATE knowledge_runs SET status='FAILED',warnings=?,finished_at=now() WHERE id=?",SECRET,run);assertEquals("PARSE_FAILED",detail("MATERIALS").items().getFirst().diagnostic());
  db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status,finished_at) SELECT ?,tenant_id,workspace_id,material_id,version_id,2,requested_by,'READY',now() FROM knowledge_runs WHERE id=?",UUID.randomUUID(),run);var ready=detail("MATERIALS");assertEquals(1,ready.counts().ready());assertEquals(0,ready.counts().attention());assertNotEquals(run,ready.items().getFirst().runId());
  materials.upload(member,tenant,space,null,m.id(),1,UUID.randomUUID(),new MockMultipartFile("file",SECRET+".txt","text/plain","new-version".getBytes()));var newer=detail("MATERIALS");assertEquals(1,newer.counts().total());assertEquals(1,newer.counts().processing());assertNull(newer.items().getFirst().lastSuccessAt());
  var metadata=newer.items().getFirst();assertEquals("TXT",metadata.format());assertEquals(11L,metadata.sizeBytes());assertEquals(2,metadata.version());assertNull(metadata.datasetCount());assertNull(metadata.rowCount());
  String json=new JsonMapper().writeValueAsString(newer);for(String secret:List.of(SECRET,m.id().toString(),member.toString(),space.toString(),"filename","warnings","workspaceId"))assertFalse(json.contains(secret));
 }
 @Test void safeDatasetMetadataCountsOnlyActiveObjectsWithoutBusinessRows(){
  UUID c=connection(tenant,"READY"),r=run(tenant,c,"SUCCEEDED",1),d=UUID.randomUUID(),snap=UUID.randomUUID();
  db.update("UPDATE workspaces SET kind='SHARED' WHERE id=?",space);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,?,?,?::jsonb)",d,tenant,c,space,SECRET,SECRET,"[\"private_column\"]");
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,?::jsonb,1,now())",snap,tenant,c,d,r,"[{\"private_column\":\""+SECRET+"\"}]");
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,d);
  var item=detail("CONNECTIONS").items().getFirst();assertEquals(1L,item.datasetCount());assertEquals(1L,item.rowCount());assertNull(item.format());assertNull(item.sizeBytes());assertNull(item.version());
  String projection=new JsonMapper().writeValueAsString(detail("CONNECTIONS"));assertFalse(projection.contains(SECRET));assertFalse(projection.contains("private_column"));assertFalse(projection.contains(snap.toString()));
  db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",d);
  var withdrawn=detail("CONNECTIONS").items().getFirst();assertEquals(0L,withdrawn.datasetCount());assertEquals(0L,withdrawn.rowCount());
 }
 @Test void archivesPageAcrossEnterprisesWithoutPrivatePayloads(){
  connection(tenant,"UNCONFIGURED");connection(other,"UNCONFIGURED");
  var page=service.archives(operator,"CONNECTIONS","ALL",0);
  assertTrue(page.items().stream().anyMatch(r->r.tenantId().equals(tenant)));
  assertTrue(page.items().stream().anyMatch(r->r.tenantId().equals(other)));
  assertTrue(page.items().size()<=20);
  var payload=new JsonMapper().writeValueAsString(page);assertFalse(payload.contains(SECRET));assertFalse(payload.contains("routeLabel"));
  denied(403,()->service.archives(member,"CONNECTIONS","ALL",0));
  denied(400,()->service.archives(operator,"CONNECTIONS","ALL",20001));
  db.update("DELETE FROM platform_roles WHERE account_id=?",operator);denied(403,()->service.archives(operator,"MATERIALS","ALL",0));
 }
 @Test void scopeChecksBoundsSuspensionAndRevocation(){denied(403,()->service.list(member,"CONNECTIONS","","ALL",0));denied(404,()->service.detail(operator,UUID.randomUUID(),"MATERIALS","ALL",0));for(String k:List.of("FILES","connection",""))denied(400,()->service.list(operator,k,"","ALL",0));denied(400,()->service.list(operator,"CONNECTIONS","","BROKEN",0));denied(400,()->service.list(operator,"CONNECTIONS","x".repeat(181),"ALL",0));denied(400,()->service.detail(operator,tenant,"MATERIALS","ALL",20001));
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertEquals("SUSPENDED",detail("MATERIALS").tenantStatus());db.update("DELETE FROM platform_roles WHERE account_id=?",operator);denied(403,()->detail("MATERIALS"));
 }
 @Test void customerLoginCannotReadPlatformDataEvenForItsOwnTenant()throws Exception{
  db.update("DELETE FROM login_attempts");String base="http://127.0.0.1:"+port;var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();
  var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",member+"@example.test","password",PASSWORD)))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
  for(String path:List.of("/api/platform-admin/v1/data-operations","/api/platform-admin/v1/data-operations/archives","/api/platform-admin/v1/tenants/"+tenant+"/data-operations"))assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
 }
 @Test void independentPlatformHttpReturnsOnlyReadOnlyNoStoreProjection()throws Exception{db.update("DELETE FROM login_attempts");connection(tenant,"UNAVAILABLE");String base="http://127.0.0.1:"+port,path="/api/platform-admin/v1/tenants/"+tenant+"/data-operations";var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();
  assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/platform-admin/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  var login=HttpRequest.newBuilder(URI.create(base+"/api/platform-admin/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("username",operator+"@example.test","password",PASSWORD)))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
  var r=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,r.statusCode());assertEquals("private, no-store",r.headers().firstValue("Cache-Control").orElseThrow());assertFalse(r.body().contains(SECRET));
  assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/tenants/"+tenant+"/database/connections")).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  db.update("DELETE FROM platform_roles WHERE account_id=?",operator);assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
 }
}
