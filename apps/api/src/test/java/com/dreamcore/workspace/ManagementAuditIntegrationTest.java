package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.collection.enabled=false"})
class ManagementAuditIntegrationTest {
 @Autowired JdbcTemplate db; @Autowired TenantAdminService service;
 UUID tenant,other,admin,member; Instant start=Instant.parse("2026-10-12T00:00:00Z");
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();other=UUID.randomUUID();admin=UUID.randomUUID();member=UUID.randomUUID();
  for(UUID id:List.of(tenant,other))db.update("INSERT INTO tenants(id,name) VALUES (?,'审计合成企业')",id);
  for(UUID id:List.of(admin,member)){
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused')",id,id+"@audit.test",id.equals(admin)?"合成管理员":"合成员工");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
  }
 }
 void event(UUID t,String action,String outcome,Instant at){db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,created_at) VALUES (?,?,?,?,?,?::timestamptz)",admin,t,action,t,outcome,at.toString());}
 @Test void filtersRunBeforePaginationAndRespectExclusiveEnd(){
  for(int i=0;i<25;i++)event(tenant,"COLLECTION_NOW","SUCCESS",start.plusSeconds(i));
  event(tenant,"TENANT_RENAME","SUCCESS",start.plusSeconds(26));
  var page=service.records(admin,tenant,0,21,"合成管理员","DATA",start,start.plusSeconds(25));
  assertEquals(21,page.size());assertEquals(start.plusSeconds(24),page.getFirst().createdAt());
  var next=service.records(admin,tenant,20,21,"合成管理员","DATA",start,start.plusSeconds(25));assertEquals(5,next.size());
  assertEquals(1,service.records(admin,tenant,0,21,"审计合成企业","COMPANY",null,null).size());
  assertEquals(1,service.records(admin,tenant,0,21,"","DATA",start,start.plusSeconds(1)).size());
 }
 @Test void managementWhitelistNeverReturnsPrivateActivityOrOtherTenant(){
  event(tenant,"TENANT_RENAME","SUCCESS",start);event(other,"TENANT_RENAME","SUCCESS",start);
  event(tenant,"MATERIAL_DOWNLOAD","SUCCESS",start);event(tenant,"TENANT_RENAME","DENIED",start);
  assertEquals(1,service.records(admin,tenant,0,21).size());
  assertTrue(service.records(admin,tenant,0,21,"MATERIAL_DOWNLOAD","",null,null).isEmpty());
  assertThrows(IdentityException.class,()->service.records(admin,other,0,21));
 }
 @Test void memberAndRevokedAdministratorCannotReadRecords(){
  event(tenant,"TENANT_RENAME","SUCCESS",start);
  assertThrows(IdentityException.class,()->service.records(member,tenant,0,21));
  db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,admin);
  assertThrows(IdentityException.class,()->service.records(admin,tenant,0,21));
 }
 @Test void invalidFiltersRejectedAndSqlLikeTextIsLiteral(){
  event(tenant,"TENANT_RENAME","SUCCESS",start);
  assertThrows(IdentityException.class,()->service.records(admin,tenant,0,21,"","ALL_SQL",null,null));
  assertThrows(IdentityException.class,()->service.records(admin,tenant,0,21,"","",start,start));
  assertThrows(IdentityException.class,()->service.records(admin,tenant,0,21,"x".repeat(161),"",null,null));
  assertTrue(service.records(admin,tenant,0,21,"' OR 1=1 --","",null,null).isEmpty());
  assertEquals(1,service.records(admin,tenant,0,21).size());
 }
}
