package com.dreamcore.workspace;

import com.dreamcore.workspace.activity.ActivityService;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.identity.IdentityException;
import java.net.*;
import java.net.http.*;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.initial-delay-ms=3600000"})
class ActivityIntegrationTest {
 @Autowired ActivityService activity; @Autowired MaterialService materials; @Autowired JdbcTemplate db; @Autowired PasswordEncoder passwords;
 @LocalServerPort int port;
 UUID tenant,other,author,reader,admin,operator,shared,hidden,personal,foreign;
 static final String PASSWORD="synthetic-activity-password";
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();other=UUID.randomUUID();author=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();operator=UUID.randomUUID();shared=UUID.randomUUID();hidden=UUID.randomUUID();personal=UUID.randomUUID();foreign=UUID.randomUUID();
  for(UUID actor:List.of(author,reader,admin,operator))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,actor+"@example.test","合成维护成员",passwords.encode(PASSWORD));
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
  db.update("INSERT INTO tenants(id,name) VALUES (?,'动态企业'),(?,'另一企业')",tenant,other);
  for(UUID actor:List.of(author,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,author);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享空间','SHARED'),(?,?,?,'不可见空间','SHARED'),(?,?,?,'个人空间','PERSONAL'),(?,?,?,'其他企业空间','SHARED')",shared,tenant,admin,hidden,tenant,admin,personal,tenant,author,foreign,other,author);
  for(UUID space:List.of(shared,hidden))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,author);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,shared,reader);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",other,foreign,author);
 }
 @AfterEach void cleanupRole(){db.update("DELETE FROM platform_roles WHERE account_id=?",operator);}
 MaterialService.Entry upload(UUID t,UUID space,String name){return materials.upload(author,t,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain","synthetic".getBytes()));}
 void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
 @Test void filtersSharedGrantsBeforePaginationWithoutExposingPrivateOrHiddenCounts(){
  var visible=upload(tenant,shared,"可见.txt");upload(tenant,hidden,"秘密.txt");upload(tenant,personal,"私人.txt");upload(other,foreign,"其他企业.txt");
  var result=activity.list(reader,tenant,null,null,1);
  assertEquals(1,result.items().size());assertEquals(visible.id(),result.items().getFirst().materialId());assertNull(result.nextCursor());
  assertEquals("MATERIAL_UPLOADED",result.items().getFirst().kind());
  assertTrue(activity.list(admin,tenant,null,null,20).items().isEmpty());
  denied(403,()->activity.list(operator,tenant,null,null,20));denied(403,()->activity.list(reader,other,null,null,20));
  for(UUID scope:List.of(hidden,personal,foreign,UUID.randomUUID()))denied(404,()->activity.list(reader,tenant,scope,null,20));
  denied(404,()->activity.list(author,tenant,personal,null,20));
 }
 @Test void retriesAndFailedUpdatesDoNotAddEventsAndVersionDownloadsStayExact(){
  UUID key=UUID.randomUUID();var file=new MockMultipartFile("file","原件.txt","text/plain","v1".getBytes());
  var first=materials.upload(author,tenant,shared,null,null,null,key,file);materials.upload(author,tenant,shared,null,null,null,key,file);
  var old=activity.list(reader,tenant,shared,null,20).items().getFirst();
  materials.upload(author,tenant,shared,null,first.id(),1,UUID.randomUUID(),new MockMultipartFile("file","修订.txt","text/plain","v2".getBytes()));
  denied(409,()->materials.upload(author,tenant,shared,null,first.id(),1,UUID.randomUUID(),file));
  var result=activity.list(reader,tenant,shared,null,20);assertEquals(2,result.items().size());
  assertEquals("MATERIAL_UPDATED",result.items().getFirst().kind());assertEquals("修订.txt",result.items().getFirst().filename());
  assertArrayEquals("v1".getBytes(),materials.download(reader,tenant,shared,first.id(),old.id()).bytes());
  assertEquals(2,activity.list(reader,tenant,shared,null,20).items().size());
 }
 @Test void keysetPaginationHandlesEqualTimesAndNewerInserts(){
  for(int i=0;i<5;i++)upload(tenant,shared,"记录"+i+".txt");
  db.update("UPDATE material_versions SET created_at='2026-09-01T00:00:00Z' WHERE tenant_id=?",tenant);
  var first=activity.list(reader,tenant,null,null,2);assertNotNull(first.nextCursor());
  upload(tenant,shared,"新记录.txt");
  var seen=new HashSet<UUID>();first.items().forEach(x->assertTrue(seen.add(x.id())));
  String cursor=first.nextCursor();
  while(cursor!=null){var next=activity.list(reader,tenant,null,cursor,2);next.items().forEach(x->assertTrue(seen.add(x.id())));cursor=next.nextCursor();}
  assertEquals(5,seen.size());assertEquals("新记录.txt",activity.list(reader,tenant,null,null,2).items().getFirst().filename());
  for(String invalid:List.of("", "invalid", "2026-09-01T00:00:00Z~1-1-1-1-1","x".repeat(101)))denied(400,()->activity.list(reader,tenant,null,invalid,20));
  denied(400,()->activity.list(reader,tenant,null,null,0));denied(400,()->activity.list(reader,tenant,null,null,51));
 }
 @Test void revocationAppliesToExistingCursorsAndHistoricalAuthorsCanBeDisabled(){
  upload(tenant,shared,"A.txt");upload(tenant,shared,"B.txt");String cursor=activity.list(reader,tenant,null,null,1).nextCursor();
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,author);
  assertEquals(2,activity.list(reader,tenant,null,null,20).items().size());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,reader);
  assertTrue(activity.list(reader,tenant,null,cursor,20).items().isEmpty());denied(404,()->activity.list(reader,tenant,shared,cursor,20));
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,reader);
  denied(403,()->activity.list(reader,tenant,null,null,20));
  db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=? AND account_id=?",tenant,reader);
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->activity.list(reader,tenant,null,null,20));
  db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",reader);denied(401,()->activity.list(reader,tenant,null,null,20));
 }
 @Test void waitingReaderRechecksGrantAfterPermissionTransaction()throws Exception{
  upload(tenant,shared,"撤权.txt");
  try(var pool=Executors.newSingleThreadExecutor();Connection writer=Objects.requireNonNull(db.getDataSource()).getConnection()){
   writer.setAutoCommit(false);
   try(var lock=writer.prepareStatement("SELECT id FROM tenants WHERE id=? FOR UPDATE")){lock.setObject(1,tenant);lock.executeQuery();}
   var started=new CountDownLatch(1);var pending=pool.submit(()->{started.countDown();return activity.list(reader,tenant,null,null,20);});
   started.await();
   // Wait for an actual PostgreSQL lock waiter, not a timing-only guess.
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
   while(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM tenants%FOR SHARE%'",Integer.class)==0 && System.nanoTime()<deadline)Thread.sleep(10);
   assertTrue(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM tenants%FOR SHARE%'",Integer.class)>0);
   try(var remove=writer.prepareStatement("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?")){remove.setObject(1,shared);remove.setObject(2,reader);remove.executeUpdate();}
   writer.commit();assertTrue(pending.get(5,TimeUnit.SECONDS).items().isEmpty());
  }
 }
 @Test void httpContractRequiresSessionAndDoesNotCacheOrLeakErrors()throws Exception{
  upload(tenant,shared,"HTTP资料.txt");var json=new JsonMapper();
  var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String base="http://127.0.0.1:"+port;
  String path="/api/v1/tenants/"+tenant+"/activity";
  java.util.function.Function<String,HttpRequest.Builder> request=p->HttpRequest.newBuilder(URI.create(base+p));
  assertEquals(401,http.send(request.apply(path).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=json.readTree(http.send(request.apply("/api/v1/auth/csrf").GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  var login=request.apply("/api/v1/auth/login").header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",reader+"@example.test","password",PASSWORD)))).build();
  assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
  var response=http.send(request.apply(path).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode());assertEquals("private, no-store",response.headers().firstValue("Cache-Control").orElseThrow());assertFalse(response.body().contains("@example.test"));
  assertEquals(1,json.readTree(response.body()).get("items").size());
  var invalid=http.send(request.apply(path+"?workspace=bad").GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(400,invalid.statusCode());assertEquals("INVALID_REQUEST",json.readTree(invalid.body()).get("code").asString());
 }
}
