package com.dreamcore.workspace;
import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={"dreamcore.tasks.enabled=false"})
class BriefingSelectionIntegrationTest {
 @Autowired JdbcTemplate db; @Autowired BriefingGenerationService generation;
 UUID tenant,actor,space;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成数量验收')",tenant);
  db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户','unused')",actor,actor+"@example.test");
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",space,tenant,actor);
 }
 @Test void reservesTotalAndReplaysConfirmation(){
  UUID request=UUID.randomUUID();var rows=generation.generateSelection(actor,tenant,request,space,3,List.of("INSIGHT","SUGGESTION"));
  assertEquals(Arrays.asList("INSIGHT","SUGGESTION","INSIGHT"),rows.stream().map(BriefingGenerationService.Batch::businessType).toList());
  assertEquals(rows.stream().map(BriefingGenerationService.Batch::id).toList(),generation.generateSelection(actor,tenant,request,space,3,List.of("INSIGHT","SUGGESTION")).stream().map(BriefingGenerationService.Batch::id).toList());
  assertEquals(3,generation.state(actor,tenant).quota().remaining());
  assertEquals("BRIEFING_REQUEST_CONFLICT",assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,request,space,2,List.of())).code);
  assertEquals("BRIEFING_DAILY_QUOTA_EXCEEDED",assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,UUID.randomUUID(),space,4,List.of())).code);
  generation.cancel(actor,tenant,rows.getFirst().id());assertEquals(6,generation.state(actor,tenant).quota().remaining());
  for(var row:rows)assertEquals("CANCELLED",generation.get(actor,tenant,row.id()).status());
 }
 @Test void concurrentSelectionsCannotReserveMoreThanSix() throws Exception {
  var pool=Executors.newFixedThreadPool(2);try {
   Callable<Boolean> work=()->{try{generation.generateSelection(actor,tenant,UUID.randomUUID(),space,4,List.of());return true;}catch(IdentityException e){assertEquals("BRIEFING_DAILY_QUOTA_EXCEEDED",e.code);return false;}};
   var results=pool.invokeAll(List.of(work,work));assertEquals(1,results.stream().filter(f->{try{return f.get();}catch(Exception e){throw new RuntimeException(e);}}).count());
   assertEquals(4,generation.state(actor,tenant).quota().reserved());
  }finally{pool.shutdownNow();}
 }
 @Test void rejectsCrossTenantSpaceAndInvalidTypeSelection(){
  UUID outsider=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'其他企业')",outsider);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",outsider,actor);UUID otherSpace=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'受限空间','PERSONAL')",otherSpace,outsider,actor);
  assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,UUID.randomUUID(),otherSpace,1,List.of()));
  assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,UUID.randomUUID(),space,1,List.of("DATA","INSIGHT")));
  assertThrows(IdentityException.class,()->generation.generateSelection(actor,tenant,UUID.randomUUID(),space,2,List.of("DATA","DATA")));
  assertEquals(0,generation.state(actor,tenant).quota().reserved());
 }
}
