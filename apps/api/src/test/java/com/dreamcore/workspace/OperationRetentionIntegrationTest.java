package com.dreamcore.workspace;
import com.dreamcore.workspace.retention.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.time.*;import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
@SpringBootTest(properties={"dreamcore.operation-retention.enabled=false","dreamcore.tasks.enabled=false"})
class OperationRetentionIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired OperationRetentionService service;@Autowired RetentionService policies;
 @MockitoSpyBean RetentionClock clock;
 UUID tenant,actor,member,space,conversation,task;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();member=UUID.randomUUID();space=UUID.randomUUID();conversation=UUID.randomUUID();task=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成操作保留企业')",tenant);
  for(UUID a:List.of(actor,member)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成账号','unused')",a,a+"@retention-operation.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(actor)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'私有','PERSONAL')",space,tenant,actor);
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'长期保存的会话')",conversation,tenant,space,actor);
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,finished_at) VALUES (?,?,?,?,?,'长期保存的原始问题','SOURCE_LOOKUP','SUCCEEDED',now())",task,tenant,space,conversation,actor);
 }
 @AfterEach void resetClock(){reset(clock);}
 long close(){return db.queryForObject("INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision) VALUES (?,?,?,?,'SUCCEEDED',1) RETURNING seq",Long.class,tenant,space,conversation,task);}
 Map<String,Object> window(){return db.queryForMap("SELECT * FROM operation_retention_windows WHERE task_id=? ORDER BY id LIMIT 1",task);}
 Instant instant(Object time){return ((java.sql.Timestamp)time).toInstant();}
 void dueNow(){doReturn(instant(window().get("due_at")).plusSeconds(1)).when(clock).now();}
 @Test void fixedClosedAnchorUsesPolicyAndOnlyNewPolicyAffectsNewWindows(){policies.configure(actor,tenant,"MINIMAL_OPERATION",UUID.randomUUID(),0,3,"合成保留三天");close();var before=window();assertEquals(Duration.ofDays(3),Duration.between(instant(before.get("original_anchor")),instant(before.get("due_at"))));policies.configure(actor,tenant,"MINIMAL_OPERATION",UUID.randomUUID(),1,1,"仅后续新闭合事件一天");assertEquals(before,window());assertEquals(1,before.get("policy_revision"));assertTrue(service.due().isEmpty());}
 @Test void expiryRemovesOnlyBoundedNotificationDuplicatesAndPreservesBusinessAndReplayGuards(){long event=close();var row=window();UUID request=UUID.randomUUID();db.update("INSERT INTO identity_requests(actor_id,request_id,operation,fingerprint,target_id) VALUES (?,?,'CONVERSATION_SUBMIT','stable',?)",actor,request,task);db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome,created_at) VALUES (?,?,'TASK_COMPLETE',?,'SUCCESS',?),(?,?,'MEMBER_DISABLE',?,'SUCCESS',?)",actor,tenant,task,row.get("original_anchor"),actor,tenant,task,row.get("original_anchor"));db.update("INSERT INTO conversation_events(tenant_id,workspace_id,conversation_id,task_id,kind,revision) VALUES (?,?,?,?,'RUNNING',2)",tenant,space,conversation,task);dueNow();service.clean((Long)row.get("id"));var status=service.tenant(actor,tenant);assertEquals(1,status.complete());assertEquals(1,status.removedEvents());assertEquals(1,status.removedAudit());assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_events WHERE seq=?",Integer.class,event));assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_events WHERE task_id=?",Integer.class,task));assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_requests WHERE request_id=?",Integer.class,request));assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE target_id=?",Integer.class,task));assertEquals("长期保存的原始问题",db.queryForObject("SELECT prompt FROM conversation_tasks WHERE id=?",String.class,task));service.clean((Long)row.get("id"));assertEquals(status,service.tenant(actor,tenant));}
 @Test void unknownResultCannotLoseItsInvestigationRecord(){db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN',reconciliation_required=true WHERE id=?",task);close();assertEquals(0,db.queryForObject("SELECT count(*) FROM operation_retention_windows WHERE task_id=?",Integer.class,task));}
 @Test void failureRollsBackDeletesAndRetryRetainsOriginalDeadline(){close();var row=window();dueNow();db.execute("CREATE FUNCTION fail_operation_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cleanup failure'; END $$");db.execute("CREATE TRIGGER operation_test_delete BEFORE DELETE ON conversation_events FOR EACH ROW EXECUTE FUNCTION fail_operation_test_delete()");try{assertThrows(RuntimeException.class,()->service.clean((Long)row.get("id")));service.failed((Long)row.get("id"));assertEquals(1,service.tenant(actor,tenant).failed());assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_events WHERE task_id=?",Integer.class,task));}finally{db.execute("DROP TRIGGER operation_test_delete ON conversation_events");db.execute("DROP FUNCTION fail_operation_test_delete()");}service.clean((Long)row.get("id"));assertEquals("COMPLETE",window().get("state"));assertEquals(row.get("due_at"),window().get("due_at"));assertEquals(2,window().get("attempts"));}
 @Test void aggregateStatusRequiresConfigurationOrPlatformAuthority(){close();assertEquals(403,assertThrows(IdentityException.class,()->service.tenant(member,tenant)).status);assertEquals(403,assertThrows(IdentityException.class,()->service.platform(actor)).status);assertEquals(1,service.tenant(actor,tenant).pending());}
}
