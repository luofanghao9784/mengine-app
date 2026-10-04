package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;import com.dreamcore.workspace.material.MaterialService;
import java.nio.file.*;import java.net.*;import java.net.http.*;import java.util.*;
import org.junit.jupiter.api.*;import org.junit.jupiter.api.io.TempDir;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.boot.test.web.server.LocalServerPort;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.mock.web.MockMultipartFile;import org.springframework.security.crypto.password.PasswordEncoder;import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.knowledge.enabled=false","dreamcore.collection.enabled=false","dreamcore.backup.status-file="})
class PlatformStorageIntegrationTest {
 @Autowired PlatformStorageService service;@Autowired IdentityService identities;@Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired PasswordEncoder passwords;@LocalServerPort int port;@TempDir Path root;
 UUID tenant,operator,member,space;static final String SECRET="private-storage-content",PASSWORD="synthetic-storage-password";
 @BeforeEach void setup(){tenant=UUID.randomUUID();operator=UUID.randomUUID();member=UUID.randomUUID();space=UUID.randomUUID();
  for(UUID a:List.of(operator,member))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",a,a+"@example.test",SECRET,passwords.encode(PASSWORD));
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",operator,operator+"@example.test",passwords.encode(PASSWORD));
  db.update("INSERT INTO tenants(id,name) VALUES (?,?)",tenant,SECRET);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,member);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,'PERSONAL')",space,tenant,member,SECRET);
 }
 @AfterEach void cleanup(){db.update("DELETE FROM platform_roles WHERE account_id=?",operator);}
 @Test void projectsStorageFactsAndRecordedPhysicalCleanupWithoutContent(){
  var before=service.status(operator);assertTrue(before.storage().databaseBytes()>0);assertTrue(before.storage().knowledgeBytes()>=0);assertEquals("NOT_CONFIGURED",before.backup().state());assertTrue(before.backup().events().isEmpty());
  byte[] payload=SECRET.getBytes();var m=materials.upload(member,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",SECRET+".txt","text/plain",payload));
  var uploaded=service.status(operator);assertEquals(before.storage().registeredOriginalBytes()+payload.length,uploaded.storage().registeredOriginalBytes());
  UUID job=UUID.randomUUID();db.update("INSERT INTO content_cleanup_jobs(id,tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,?,'MATERIAL',?,'FAILED')",job,tenant,space,m.id());
  db.update("INSERT INTO content_cleanup_blobs(job_id,object_id) SELECT ?,object_id FROM material_versions WHERE material_id=?",job,m.id());
  assertEquals(uploaded.storage().registeredOriginalBytes(),service.status(operator).storage().registeredOriginalBytes());assertEquals(before.cleanup().failed()+1,service.status(operator).cleanup().failed());
  db.update("UPDATE content_cleanup_blobs SET deleted_at=now() WHERE job_id=?",job);db.update("UPDATE content_cleanup_jobs SET state='COMPLETE',completed_at=now() WHERE id=?",job);
  var after=service.status(operator);assertEquals(before.storage().registeredOriginalBytes(),after.storage().registeredOriginalBytes());assertEquals(before.cleanup().completed()+1,after.cleanup().completed());assertNotNull(after.cleanup().lastCompletedAt());
  String json=new JsonMapper().writeValueAsString(after);for(String secret:List.of(SECRET,tenant.toString(),space.toString(),m.id().toString(),"path","filename","credentials"))assertFalse(json.contains(secret),secret);
 }
 @Test void missingObjectDirectoryIsNotCreatedByMonitoring()throws Exception{
  Path missing=root.resolve("must-not-create");var observations=new BackupObservationReader("",900);
  var isolated=new PlatformStorageService(db,identities,observations,missing.toString());assertEquals("UNAVAILABLE",isolated.status(operator).storage().originalVolume().state());assertFalse(Files.exists(missing));
  var observed=new PlatformStorageService(db,identities,observations,root.toString()).status(operator).storage().originalVolume();assertEquals("OBSERVED",observed.state());assertTrue(observed.totalBytes()>0);assertTrue(observed.usableBytes()<=observed.totalBytes());
  Files.createSymbolicLink(missing,root);assertEquals("UNAVAILABLE",isolated.status(operator).storage().originalVolume().state());
 }
 HttpClient login(boolean platform)throws Exception{db.update("DELETE FROM login_attempts");var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String base="http://127.0.0.1:"+port+(platform?"/api/platform-admin/v1/auth":"/api/v1/auth");var json=new JsonMapper();var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  var body=Map.of(platform?"username":"email",(platform?operator:member)+"@example.test","password",PASSWORD);var req=HttpRequest.newBuilder(URI.create(base+"/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();assertEquals(200,http.send(req,HttpResponse.BodyHandlers.ofString()).statusCode());return http;
 }
 HttpResponse<String> get(HttpClient http)throws Exception{return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/platform-admin/v1/storage-status")).GET().build(),HttpResponse.BodyHandlers.ofString());}
 @Test void independentPlatformLoginNoStoreAndRevocationAreEnforced()throws Exception{
  assertEquals(401,get(HttpClient.newHttpClient()).statusCode());assertEquals(401,get(login(false)).statusCode());
  var platform=login(true);var r=get(platform);assertEquals(200,r.statusCode());assertEquals("private, no-store",r.headers().firstValue("Cache-Control").orElseThrow());assertFalse(r.body().contains(SECRET));
  db.update("DELETE FROM platform_roles WHERE account_id=?",operator);assertEquals(401,get(platform).statusCode());assertEquals(403,assertThrows(IdentityException.class,()->service.status(member)).status);
 }
}
