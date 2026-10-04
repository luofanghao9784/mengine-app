package com.dreamcore.workspace;
import com.dreamcore.workspace.briefing.PersonalFollowBoard;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class PersonalFollowBoardIntegrationTest {
 @Autowired PersonalFollowBoard service;
 @Autowired JdbcTemplate db;
 final JsonMapper json=new JsonMapper();
 UUID tenant,other,owner,reader;
 @BeforeEach void fixture() {
  tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();
  for(UUID actor:List.of(owner,reader)) db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES(?,?,?,?)",actor,actor+"@example.test","合成布局测试","unused-test-hash");
  db.update("INSERT INTO tenants(id,name) VALUES(?,'布局测试'),(?,'其他企业')",tenant,other);
  for(UUID actor:List.of(owner,reader)) db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES(?,?,'MEMBER')",tenant,actor);
 }
 JsonNode preference(int row) { return json.readTree("{\"sizes\":{\"card-1\":\"2×2\"},\"layout\":{\"columns\":4,\"order\":[\"card-1\"],\"manual\":[\"card-1\"],\"positions\":[{\"id\":\"card-1\",\"row\":"+row+",\"col\":0,\"size\":\"2×2\"}]}}"); }
 void denied(int status,Runnable run) { assertEquals(status,assertThrows(IdentityException.class,run::run).status); }
 @Test void savesAcrossReadsButIsolatesAccountsTenantsAndBoards() {
  var p=preference(1); service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),0,p);
  assertEquals(p,service.get(owner,tenant,"PRIVATE").preference());
  assertNull(service.get(reader,tenant,"PRIVATE").preference());
  assertNull(service.get(owner,tenant,"PUBLICATIONS").preference());
  denied(403,()->service.get(owner,other,"PRIVATE"));
  denied(403,()->service.save(owner,other,"PRIVATE",UUID.randomUUID(),0,p));
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);
  denied(403,()->service.get(owner,tenant,"PRIVATE"));
 }
 @Test void staleDevicesCannotOverwriteAndRetriesDoNotReapply() {
  var id=UUID.randomUUID();var p=preference(1);
  var first=service.save(owner,tenant,"PRIVATE",id,0,p);assertEquals(1,first.appliedRevision());
  service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),1,preference(2));
  var replay=service.save(owner,tenant,"PRIVATE",id,0,p);
  assertEquals(1,replay.appliedRevision());assertEquals(2,replay.current().revision());
  assertEquals(preference(2),replay.current().preference());
  denied(409,()->service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),1,p));
  var reset=service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),2,null);
  assertNull(reset.current().preference());assertEquals(3,reset.current().revision());
 }
 @Test void rejectsInvalidAndContentBearingPayloads() {
  denied(400,()->service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),0,json.readTree("{\"secret\":\"body\"}")));
  denied(400,()->service.save(owner,tenant,"PRIVATE",UUID.randomUUID(),0,preference(-1)));
  denied(400,()->service.get(owner,tenant,"OTHER"));
  assertEquals(0,service.get(owner,tenant,"PRIVATE").revision());
 }
}
