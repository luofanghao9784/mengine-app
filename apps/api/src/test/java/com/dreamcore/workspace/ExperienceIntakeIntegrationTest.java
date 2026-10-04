package com.dreamcore.workspace;

import com.dreamcore.workspace.experience.*;
import com.dreamcore.workspace.feedback.FeedbackService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.tasks.agent-mode=off","dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false"})
class ExperienceIntakeIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired ExperienceIntakeService intake;@Autowired FeedbackService feedback;
 UUID tenant,owner,admin,space,task;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();task=UUID.randomUUID();UUID conversation=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成经验采集企业')",tenant);
  for(UUID a:List.of(owner,admin)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成主体','unused')",a,a+"@intake.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'private-conversation-title')",conversation,tenant,space,owner);
  // Deliberately synthetic database fixture for the live classification; no actual model call or business proof.
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) VALUES (?,?,?,?,?,'private-prompt','AGENT','SUCCEEDED',3,1,'private-answer','live','synthetic-fixture',now())",task,tenant,space,conversation,owner);
  db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,snapshot) SELECT id,1,?,'private-input','SUCCEEDED','RECORDED',to_jsonb(t) FROM conversation_tasks t WHERE id=?",UUID.randomUUID(),task);
 }
 FeedbackService.Feedback feedback(){return feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("TASK",task,3,1,"task-v1",0),new FeedbackService.Assessment("PARTIAL",List.of("DATA_GAP"),"private-feedback-comment"));}
 int count(){return db.queryForObject("SELECT count(*) FROM experience_intake_sources WHERE tenant_id=?",Integer.class,tenant);}
 UUID source(String kind){return db.queryForObject("SELECT id FROM experience_intake_sources WHERE tenant_id=? AND kind=? ORDER BY source_revision DESC LIMIT 1",UUID.class,tenant,kind);}
 @Test void actualWorkerDiscoversReferencesOnceWithoutCopyingPrivateContentOrAdmittingExperience(){
  var f=feedback();new ExperienceIntakeWorker(intake,false).scan();assertEquals(0,count());var worker=new ExperienceIntakeWorker(intake,true);worker.scan();worker.scan();assertEquals(2,count());
  assertTrue(intake.available(source("TASK")));assertTrue(intake.available(source("FEEDBACK")));
  var json=db.queryForList("SELECT row_to_json(i)::text FROM experience_intake_sources i WHERE tenant_id=?",String.class,tenant);assertTrue(json.stream().noneMatch(v->v.contains("private-")));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
  assertThrows(IdentityException.class,()->feedback.get(admin,tenant,f.id()));
 }
 @Test void syntheticExecutionAndItsFeedbackAreNotBusinessEvidence(){
  db.update("UPDATE conversation_tasks SET execution_class='verification' WHERE id=?",task);feedback();intake.discover();assertEquals(0,count());
 }
 @Test void changedFeedbackVersionInvalidatesOldSourceAndWithdrawalDoesNotBecomeCandidate(){
  var f=feedback();intake.discover();UUID old=source("FEEDBACK");
  feedback.edit(owner,tenant,f.id(),UUID.randomUUID(),1,new FeedbackService.Assessment("ACHIEVED",List.of(),"private-correction"),false);
  assertFalse(intake.available(old));intake.discover();assertEquals(3,count());assertEquals("SOURCE_UNAVAILABLE",db.queryForObject("SELECT state FROM experience_intake_sources WHERE id=?",String.class,old));
  UUID next=source("FEEDBACK");assertNotEquals(old,next);assertTrue(intake.available(next));
  feedback.edit(owner,tenant,f.id(),UUID.randomUUID(),2,null,true);assertFalse(intake.available(next));intake.discover();assertEquals(3,count());
 }
 @Test void revokingAndRestoringAccessDoesNotRevivePendingInput(){
  feedback();intake.discover();UUID id=source("TASK");db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);
  assertFalse(intake.available(id));intake.discover();assertEquals(2,count());assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_intake_sources WHERE tenant_id=? AND state='PENDING'",Integer.class,tenant));
 }
 @Test void pausedServiceDoesNotGenerateNewInputsOrConfusePauseWithQualityFailure(){
  intake.discover();UUID id=source("TASK");db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);intake.discover();assertTrue(intake.available(id));assertEquals("PENDING",db.queryForObject("SELECT state FROM experience_intake_sources WHERE id=?",String.class,id));
 }
 @Test void failedTasksEnterOnlyAsFeedbackSourcesNotSuccessfulTaskEvidence(){
  db.update("UPDATE conversation_tasks SET status='FAILED' WHERE id=?",task);feedback();intake.discover();assertEquals(1,count());assertTrue(intake.available(source("FEEDBACK")));assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_intake_sources WHERE tenant_id=? AND kind='TASK'",Integer.class,tenant));
 }
 @Test void unrecordedHistoricalSuccessDoesNotEnterAutomaticIntake(){
  db.update("DELETE FROM conversation_attempts WHERE task_id=?",task);intake.discover();assertEquals(0,count());
 }
 @Test void sourceLifecycleRemovalInvalidatesBothTaskAndFeedbackReferences(){
  feedback();intake.discover();UUID success=source("TASK"),opinion=source("FEEDBACK");
  db.update("UPDATE object_lifecycle SET state='TRASHED' WHERE kind='TASK' AND object_id=?",task);
  assertFalse(intake.available(success));assertFalse(intake.available(opinion));intake.discover();
  db.update("UPDATE object_lifecycle SET state='ACTIVE' WHERE kind='TASK' AND object_id=?",task);
  assertFalse(intake.available(success));assertFalse(intake.available(opinion));intake.discover();assertEquals(2,count());
 }
 @Test void discoveryHasBoundedPagesAndContinuesWithoutDuplicatingSources(){
  for(int n=0;n<104;n++){UUID next=UUID.randomUUID();
   db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) SELECT ?,tenant_id,workspace_id,conversation_id,requested_by,'synthetic bounded input','AGENT','SUCCEEDED',3,1,'synthetic bounded result','live','synthetic-fixture',now() FROM conversation_tasks WHERE id=?",next,task);
   db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,snapshot) SELECT id,1,?,'synthetic input','SUCCEEDED','RECORDED',to_jsonb(t) FROM conversation_tasks t WHERE id=?",UUID.randomUUID(),next);
  }
  intake.discover();assertTrue(count()<=100);for(int n=0;n<5 && count()<105;n++)intake.discover();assertEquals(105,count());intake.discover();assertEquals(105,count());
 }
}
