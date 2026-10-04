package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.profile.*;
import java.net.*;import java.net.http.*;import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class CompanyInformationIntegrationTest {
 @Autowired TenantAdminService tenantAdmin;@Autowired JdbcTemplate db;@Autowired CompanyInformationService info;@Autowired ProfileService profiles;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,admin,member;static String hash;
 @BeforeEach void fixture(){tenant=UUID.randomUUID();admin=UUID.randomUUID();member=UUID.randomUUID();if(hash==null)hash=passwords.encode("synthetic-company-password");db.update("INSERT INTO tenants(id,name) VALUES (?,'原企业身份名称')",tenant);for(UUID id:List.of(admin,member)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成人员",hash);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");}}
 CompanyInformationService.Change command(CompanyInformationService.Field field,int rev,String action,UUID tag,String label,String meaning){return new CompanyInformationService.Change(UUID.randomUUID(),field,rev,action,tag,label,meaning);}
 CompanyInformationService.Group group(CompanyInformationService.Field field){return info.get(admin,tenant).groups().stream().filter(g->g.field()==field).findFirst().orElseThrow();}
 void denied(int code,Runnable work){assertEquals(code,assertThrows(IdentityException.class,work::run).status);}
 @Test void emptyOptionalFieldsDoNotRewriteTenantIdentityAndVersionsAreSharedWithProfiles(){
  assertEquals(4,info.get(admin,tenant).groups().size());assertTrue(info.get(admin,tenant).groups().stream().allMatch(g->g.revision()==0&&g.tags().isEmpty()));
  var f=CompanyInformationService.Field.NAME;var saved=info.change(admin,tenant,command(f,0,"ADD",null,"示例企业品牌",""));assertEquals("原企业身份名称",db.queryForObject("SELECT name FROM tenants WHERE id=?",String.class,tenant));
  var content=profiles.get(member,tenant,saved.tagId(),null);assertEquals(ProfileService.Scope.TENANT,content.scope());assertTrue(content.value().contains("示例企业品牌"));assertEquals(1,content.revision());assertEquals("HUMAN",group(f).tags().getFirst().origin());
  info.change(admin,tenant,command(f,1,"EDIT",saved.tagId(),"品牌修订",""));assertEquals(2,profiles.get(member,tenant,saved.tagId(),null).revision());assertTrue(profiles.get(member,tenant,saved.tagId(),1).value().contains("示例企业品牌"));assertTrue(group(f).tags().getFirst().humanProtected());
 }
 @Test void memberCannotWriteOrReadOtherTenantAndGenericProfileEditsCannotBypassTagProtection(){
  var f=CompanyInformationService.Field.BUSINESS;var command=command(f,0,"ADD",null,"业务标签","");denied(403,()->info.change(member,tenant,command));assertFalse(info.get(member,tenant).canMaintain());
  var added=info.change(admin,tenant,command);denied(409,()->profiles.save(admin,tenant,added.tagId(),1,new ProfileService.Content("overwrite","manual",ProfileService.Status.ACTIVE,null),UUID.randomUUID()));denied(409,()->profiles.withdraw(admin,tenant,added.tagId(),1,UUID.randomUUID()));
  denied(409,()->profiles.create(admin,tenant,ProfileService.Scope.TENANT,tenant,"company.fake",ProfileService.Kind.FACT,new ProfileService.Content("fake","manual",ProfileService.Status.ACTIVE,null),UUID.randomUUID()));
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一个企业')",other);denied(403,()->info.get(member,other));
 }
 @Test void removalAndGroupClearRetainHumanProtectionWithoutRestoringValues(){
  var f=CompanyInformationService.Field.TERM;var a=info.change(admin,tenant,command(f,0,"ADD",null,"转化率","已成交数占有效线索数的比例"));var b=info.change(admin,tenant,command(f,1,"ADD",null,"签约","业务术语"));
  info.change(admin,tenant,command(f,2,"REMOVE",a.tagId(),"",""));assertEquals(1,group(f).tags().size());assertTrue(db.queryForObject("SELECT protect_new_inferences FROM company_information_groups WHERE tenant_id=? AND field='TERM'",Boolean.class,tenant));assertEquals(ProfileService.Status.WITHDRAWN,profiles.get(member,tenant,a.tagId(),null).status());
  info.change(admin,tenant,command(f,3,"CLEAR",null,"",""));assertTrue(group(f).manuallyCleared());assertTrue(group(f).tags().isEmpty());assertEquals(ProfileService.Status.WITHDRAWN,profiles.get(member,tenant,b.tagId(),null).status());
  assertEquals(2,profiles.history(member,tenant,a.tagId(),0,20).items().size());
  info.change(admin,tenant,command(f,4,"ADD",null,"人工重新填写",""));assertFalse(group(f).manuallyCleared());assertTrue(db.queryForObject("SELECT protect_new_inferences FROM company_information_groups WHERE tenant_id=? AND field='TERM'",Boolean.class,tenant));
 }
 @Test void concurrentRetryIsOneWriteAndStaleMutationCannotReplaceNewContent() throws Exception {
  var f=CompanyInformationService.Field.INDUSTRY;var command=command(f,0,"ADD",null,"教育","");
  try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->info.change(admin,tenant,command));var b=pool.submit(()->info.change(admin,tenant,command));assertEquals(a.get(),b.get());}
  assertEquals(1,group(f).revision());assertEquals(1,group(f).tags().size());var records=tenantAdmin.records(admin,tenant,0,20);assertEquals(1,records.size());assertEquals("COMPANY_INFORMATION_ADD",records.getFirst().action());assertNull(records.getFirst().targetName());assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='COMPANY_INFORMATION_ADD'",Integer.class,tenant));
  var tag=group(f).tags().getFirst();denied(409,()->info.change(admin,tenant,command(f,0,"EDIT",tag.id(),"旧页面覆盖","")));
  info.change(admin,tenant,command(f,1,"EDIT",tag.id(),"体育教育",""));info.change(admin,tenant,command);assertEquals("体育教育",group(f).tags().getFirst().label());
  db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,admin);denied(403,()->info.change(admin,tenant,command));
 }
 @Test void tenantScopedDelegationAllowsMaintenanceButWorkspaceDelegationDoesNot(){
  UUID space=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,admin);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)",tenant,space,member);
  db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'PROFILE_MAINTAIN',?)",tenant,member,space,admin);
  assertFalse(info.get(member,tenant).canMaintain());denied(403,()->info.change(member,tenant,command(CompanyInformationService.Field.INDUSTRY,0,"ADD",null,"行业","")));
  db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,NULL,'PROFILE_MAINTAIN',?)",tenant,member,admin);
  assertTrue(info.get(member,tenant).canMaintain());var added=info.change(member,tenant,command(CompanyInformationService.Field.INDUSTRY,0,"ADD",null,"行业",""));
  var value=profiles.get(member,tenant,added.tagId(),null);db.queryForList("SELECT scrub_lifecycle_object('PROFILE_VERSION',?)",value.versionId());
  assertTrue(group(CompanyInformationService.Field.INDUSTRY).tags().isEmpty());denied(404,()->info.change(member,tenant,command(CompanyInformationService.Field.INDUSTRY,1,"EDIT",added.tagId(),"不可复活","")));
  assertEquals("",db.queryForObject("SELECT value FROM profile_versions WHERE id=?",String.class,value.versionId()));
 }
 @Test void schemaConstraintsAndForeignTagIdsCannotChangeOtherGroup(){
  var f=CompanyInformationService.Field.NAME;var a=info.change(admin,tenant,command(f,0,"ADD",null,"名称","") );
  denied(409,()->info.change(admin,tenant,command(f,1,"ADD",null,"第二名称","")));denied(404,()->info.change(admin,tenant,command(CompanyInformationService.Field.TERM,0,"EDIT",a.tagId(),"越组","")));
  denied(400,()->info.change(admin,tenant,command(f,1,"EDIT",a.tagId(),"","")));denied(400,()->info.change(admin,tenant,command(f,1,"EDIT",a.tagId(),"名称","名称不能带术语解释")));
  denied(400,()->info.change(admin,tenant,new CompanyInformationService.Change(UUID.randomUUID(),f,null,"ADD",null,"缺少版本","")));assertEquals(1,group(f).revision());
 }
 @Test void httpUsesCustomerSessionCsrfAndNoStore() throws Exception {
  var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port,path="/api/v1/tenants/"+tenant+"/company-information";
  assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",admin+"@example.test","password","synthetic-company-password")))).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var read=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,read.statusCode());assertTrue(read.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
  var analysis=http.send(HttpRequest.newBuilder(URI.create(base+path+"/analysis")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,analysis.statusCode());assertEquals("DISABLED",json.readTree(analysis.body()).get("state").asString());assertTrue(analysis.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
  UUID foreign=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一个合成企业')",foreign);assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/tenants/"+foreign+"/company-information/analysis")).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var body=command(CompanyInformationService.Field.NAME,0,"ADD",null,"企业背景名称","");var post=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());post.header(csrf.get("headerName").asString(),csrf.get("token").asString());assertEquals(200,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var suggestions=http.send(HttpRequest.newBuilder(URI.create(base+path+"/suggestions")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,suggestions.statusCode());assertTrue(suggestions.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals("[]",suggestions.body());
  assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+path+"/suggestions/"+UUID.randomUUID())).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}" )).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
 }
}
