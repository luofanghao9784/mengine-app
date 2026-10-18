package com.dreamcore.workspace;

import com.dreamcore.workspace.profile.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class CompanyBackgroundSourceIntegrationTest {
 @Autowired JdbcTemplate db; @Autowired CompanyInformationService info;
 @Autowired CompanyBackgroundSourceService source; @Autowired ProfileService profiles;
 UUID tenant,admin,member;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();member=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成背景企业')",tenant);
  for(UUID a:List.of(admin,member)){
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'test-only')",a,a+"@example.test","合成人员");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");
  }
 }
 CompanyInformationService.Receipt change(int rev,String action,UUID id,String label){return info.change(admin,tenant,new CompanyInformationService.Change(UUID.randomUUID(),CompanyInformationService.Field.TERM,rev,action,id,label,""));}
 void denied(int status,Runnable r){assertEquals(status,assertThrows(IdentityException.class,r::run).status);}
 @Test void readThroughSourceKeepsIdentityAndVersionWithoutDuplicateRows(){
  var empty=source.get(member,tenant);assertEquals("NO_READABLE_ENTRIES",empty.state());
  var added=change(0,"ADD",null,"到账");var first=source.get(member,tenant);
  assertEquals("AVAILABLE",first.state());assertEquals("PENDING_INTEGRATION",first.knowledgeIntegration());
  var entry=first.entries().getFirst();assertEquals(added.tagId(),entry.id());assertEquals(profiles.get(member,tenant,entry.id(),null).versionId(),entry.versionId());
  assertEquals(first,source.get(member,tenant));assertEquals(first.version(),source.get(admin,tenant).version());
  change(1,"EDIT",entry.id(),"银行确认到账");var updated=source.get(member,tenant);
  assertEquals(first.sourceId(),updated.sourceId());assertNotEquals(first.version(),updated.version());
  assertEquals(2,source.entry(member,tenant,entry.id(),2).revision());denied(409,()->source.entry(member,tenant,entry.id(),1));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM profile_entries WHERE tenant_id=?",Integer.class,tenant));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM profile_versions WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void withdrawnAndScrubbedEntriesLeaveSourceAndCannotBeReadByPinnedId(){
  var first=change(0,"ADD",null,"退款完成");change(1,"REMOVE",first.tagId(),"");
  assertTrue(source.get(member,tenant).entries().isEmpty());denied(404,()->source.entry(member,tenant,first.tagId(),1));
  var second=change(2,"ADD",null,"新术语");var v=source.entry(member,tenant,second.tagId(),1);
  db.queryForList("SELECT scrub_lifecycle_object('PROFILE_VERSION',?)",v.versionId());
  assertTrue(source.get(member,tenant).entries().isEmpty());denied(404,()->source.entry(member,tenant,second.tagId(),null));
 }
 @Test void scopeAndMembershipAreRecheckedAndGenericProfilesAreNotExported(){
  var added=change(0,"ADD",null,"术语");
  profiles.create(admin,tenant,ProfileService.Scope.TENANT,tenant,"unrelated.fact",ProfileService.Kind.FACT,new ProfileService.Content("不属于企业背景","manual",ProfileService.Status.ACTIVE,null),UUID.randomUUID());
  assertEquals(1,source.get(member,tenant).entries().size());
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'隔离企业')",other);
  denied(403,()->source.get(member,other));denied(403,()->source.entry(member,other,added.tagId(),null));
  db.update("DELETE FROM tenant_memberships WHERE tenant_id=? AND account_id=?",tenant,member);
  denied(403,()->source.get(member,tenant));denied(403,()->source.entry(member,tenant,added.tagId(),null));
 }
}
