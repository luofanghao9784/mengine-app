package com.dreamcore.workspace;
import com.dreamcore.workspace.profile.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.context.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.tasks.agent-mode=verification"})
class CompanyInferenceIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired CompanyInformationService info;@Autowired CompanyInferenceService inference;@Autowired ProfileService profiles;@Autowired TaskContextService context;@Autowired TaskContextGuard guard;
 UUID tenant,admin,member,space,personal,chunk,version,material;
 final String content="示例企业从事体育教育，主营篮球培训。🏀 转化率是签约人数占有效线索人数的比例。";
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();member=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成推断企业')",tenant);
  for(UUID a:List.of(admin,member)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'test-only')",a,a+"@example.test","合成人员");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'全员获权空间','SHARED'),(?,?,?,'个人空间','PERSONAL')",space,tenant,admin,personal,tenant,admin);
  for(UUID a:List.of(admin,member))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,a);
  chunk=source(space);material=db.queryForObject("SELECT material_id FROM knowledge_chunks WHERE id=?",UUID.class,chunk);version=db.queryForObject("SELECT version_id FROM knowledge_chunks WHERE id=?",UUID.class,chunk);
 }
 UUID source(UUID location){
  var m=materials.upload(admin,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","企业介绍.txt","text/plain",content.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  UUID v=materials.detail(admin,tenant,location,m.id(),0,20).versions().getFirst().id();var run=db.queryForObject("SELECT id FROM knowledge_runs WHERE version_id=?",UUID.class,v);db.update("UPDATE knowledge_runs SET status='READY',finished_at=now() WHERE id=?",run);
  UUID c=UUID.randomUUID();db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'第1段','TEXT',?)",c,tenant,location,m.id(),v,run,content);return c;
 }
 CompanyInformationService.Group group(CompanyInformationService.Field f){return info.get(admin,tenant).groups().stream().filter(g->g.field()==f).findFirst().orElseThrow();}
 CompanyInferenceService.Candidate candidate(CompanyInformationService.Field f,UUID target,String label){return new CompanyInferenceService.Candidate(f,target,label,"",List.of(new CompanyInferenceService.Evidence(chunk,"体育教育")));}
 void complete(CompanyInferenceService.Candidate c){var job=inference.begin(admin,tenant,List.of(chunk));inference.finish(job.id(),job.lease(),List.of(c));}
 void denied(int status,Runnable work){assertEquals(status,assertThrows(IdentityException.class,work::run).status);}
 CompanyInformationService.Receipt manual(CompanyInformationService.Field f,int rev,String action,UUID target,String label){return info.change(admin,tenant,new CompanyInformationService.Change(UUID.randomUUID(),f,rev,action,target,label,""));}
 @Test void emptyFieldsAutoFillAndAiFieldsCanUpdateWithoutHumanApproval(){
  var f=CompanyInformationService.Field.INDUSTRY;complete(candidate(f,null,"体育教育"));var tag=group(f).tags().getFirst();assertEquals("AI",tag.origin());assertFalse(tag.humanProtected());assertTrue(inference.suggestions(admin,tenant).isEmpty());
  assertEquals(version,inference.evidence(member,tenant,tag.id(),1).getFirst().versionId());assertEquals(ProfileService.Kind.INFERENCE,profiles.get(member,tenant,tag.id(),null).kind());complete(candidate(f,tag.id(),"体育培训"));assertEquals("体育培训",group(f).tags().getFirst().label());assertEquals(2,group(f).tags().getFirst().revision());
 }
 @Test void humanConflictShowsEvidenceAndRequiresAnExplicitIdempotentChoice(){
  var f=CompanyInformationService.Field.INDUSTRY;var tag=manual(f,0,"ADD",null,"人工行业");complete(candidate(f,tag.tagId(),"体育教育"));assertEquals("人工行业",group(f).tags().getFirst().label());
  var suggestion=inference.suggestions(admin,tenant).getFirst();assertEquals("体育教育",suggestion.evidence().getFirst().quote());assertEquals(version,suggestion.evidence().getFirst().versionId());denied(403,()->inference.suggestions(member,tenant));
  var choice=new CompanyInferenceService.Decision(UUID.randomUUID(),1,1,"ADOPT");var receipt=inference.decide(admin,tenant,suggestion.id(),choice);assertEquals(receipt,inference.decide(admin,tenant,suggestion.id(),choice));assertTrue(group(f).tags().getFirst().humanProtected());assertEquals("体育教育",group(f).tags().getFirst().label());
  complete(candidate(f,tag.tagId(),"篮球培训"));var next=inference.suggestions(admin,tenant).getFirst();inference.decide(admin,tenant,next.id(),new CompanyInferenceService.Decision(UUID.randomUUID(),1,2,"KEEP"));assertEquals("体育教育",group(f).tags().getFirst().label());assertTrue(inference.suggestions(admin,tenant).isEmpty());
 }
 @Test void deletedSynonymsAndClearedGroupsStayEmptyUntilAdoption(){
  var f=CompanyInformationService.Field.BUSINESS;var tag=manual(f,0,"ADD",null,"篮球培训");manual(f,1,"REMOVE",tag.tagId(),"");complete(candidate(f,null,"篮球教学"));assertTrue(group(f).tags().isEmpty());assertEquals(1,inference.suggestions(admin,tenant).size());
  manual(f,2,"CLEAR",null,"");complete(candidate(f,null,"体育培训"));assertTrue(group(f).manuallyCleared());assertTrue(group(f).tags().isEmpty());assertEquals(2,inference.suggestions(admin,tenant).size());
 }
 @Test void currentHumanRevisionWinsAnInFlightInference(){
  var f=CompanyInformationService.Field.NAME;var job=inference.begin(admin,tenant,List.of(chunk));manual(f,0,"ADD",null,"新人工名称");inference.finish(job.id(),job.lease(),List.of(candidate(f,null,"旧推断名称")));assertEquals("新人工名称",group(f).tags().getFirst().label());
  var suggestion=inference.suggestions(admin,tenant).getFirst();denied(409,()->inference.decide(admin,tenant,suggestion.id(),new CompanyInferenceService.Decision(UUID.randomUUID(),1,0,"ADOPT")));
 }
 @Test void onlyEnterpriseWideLibrarySourcesQualifyAndRegrantCannotRevivePriorRun(){
  UUID privateChunk=source(personal);denied(409,()->inference.begin(admin,tenant,List.of(privateChunk)));
  var job=inference.begin(admin,tenant,List.of(chunk));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,member);denied(409,()->inference.begin(admin,tenant,List.of(chunk)));db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,member);denied(409,()->inference.finish(job.id(),job.lease(),List.of(candidate(CompanyInformationService.Field.NAME,null,"企业"))));
  db.update("UPDATE materials SET in_library=false WHERE id=?",material);denied(409,()->inference.begin(admin,tenant,List.of(chunk)));
 }
 @Test void forgedEvidenceRollsBackWholeBatchAndUnicodeOffsetsAreExact(){
  var f=CompanyInformationService.Field.TERM;var job=inference.begin(admin,tenant,List.of(chunk));var bad=new CompanyInferenceService.Candidate(f,null,"假信息","",List.of(new CompanyInferenceService.Evidence(chunk,"原文没有此证据")));
  denied(422,()->inference.finish(job.id(),job.lease(),List.of(candidate(CompanyInformationService.Field.INDUSTRY,null,"体育教育"),bad)));assertTrue(group(CompanyInformationService.Field.INDUSTRY).tags().isEmpty());
  manual(f,0,"CLEAR",null,"");inference.finish(job.id(),job.lease(),List.of(new CompanyInferenceService.Candidate(f,null,"转化率","签约人数占有效线索人数",List.of(new CompanyInferenceService.Evidence(chunk,"转化率是签约人数占有效线索人数的比例")))));assertEquals("转化率是签约人数占有效线索人数的比例",inference.suggestions(admin,tenant).getFirst().evidence().getFirst().quote());
 }
 @Test void revocationHidesInferencesFromCompanyAndGenericProfileReadsAndManualEditsRetainSources(){
  var f=CompanyInformationService.Field.INDUSTRY;complete(candidate(f,null,"体育教育"));var tag=group(f).tags().getFirst();manual(f,1,"EDIT",tag.id(),"人工调整行业");
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,member);assertTrue(group(f).tags().isEmpty());denied(404,()->profiles.get(admin,tenant,tag.id(),null));denied(404,()->inference.evidence(admin,tenant,tag.id(),1));assertFalse(profiles.history(admin,tenant,tag.id(),0,20).items().getFirst().bodyAvailable());
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,member);assertTrue(group(f).tags().isEmpty());
  db.update("UPDATE knowledge_chunks SET content='' WHERE id=?",chunk);assertEquals(2,db.queryForObject("SELECT count(*) FROM profile_versions WHERE entry_id=? AND scrubbed AND value=''",Integer.class,tag.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM company_information_suggestions WHERE tenant_id=? AND NOT scrubbed",Integer.class,tenant));
 }
 @Test void runtimeProfileReadRegistersOriginalVersionAndRevocationRejectsCompletion(){
  complete(candidate(CompanyInformationService.Field.INDUSTRY,null,"体育教育"));var tag=group(CompanyInformationService.Field.INDUSTRY).tags().getFirst();UUID conversation=UUID.randomUUID(),task=UUID.randomUUID(),lease=UUID.randomUUID();
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'合成任务')",conversation,tenant,personal,admin);
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,execution_class,attempt,lease_token,lease_until) VALUES (?,?,?,?,?,'合成任务','AGENT','RUNNING','verification',1,?,now()+interval '5 minutes')",task,tenant,personal,conversation,admin,lease);
  db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance) VALUES (?,1,?,'合成输入','RUNNING','RECORDED')",task,lease);
  context.context(task,lease,new TaskContextService.Request("profile_read",null,null,null,tag.id(),null,1,null,null,null,null));assertEquals(version,db.queryForObject("SELECT version_id FROM task_context_materials WHERE task_id=?",UUID.class,task));guard.requireCurrent(task);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,member);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,member);denied(409,()->guard.requireCurrent(task));
 }
 @Test void manualGroupCannotBeBypassedWithANewSynonymAndUnrelatedRecycleDoesNotHideAnInference(){
  var f=CompanyInformationService.Field.BUSINESS;manual(f,0,"ADD",null,"篮球培训");complete(candidate(f,null,"篮球教学"));assertEquals(1,group(f).tags().size());assertEquals(1,inference.suggestions(admin,tenant).size());
  complete(candidate(CompanyInformationService.Field.INDUSTRY,null,"体育教育"));UUID unrelated=source(space);UUID unrelatedMaterial=db.queryForObject("SELECT material_id FROM knowledge_chunks WHERE id=?",UUID.class,unrelated);
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,unrelatedMaterial);
  assertEquals(1,group(CompanyInformationService.Field.INDUSTRY).tags().size());
 }
 @Test void adoptingAStaleAutomaticProposalProtectsLaterNewLabelSuggestions(){
  var f=CompanyInformationService.Field.INDUSTRY;complete(candidate(f,null,"体育教育"));var tag=group(f).tags().getFirst();
  var earlier=inference.begin(admin,tenant,List.of(chunk));complete(candidate(f,tag.id(),"体育培训"));inference.finish(earlier.id(),earlier.lease(),List.of(candidate(f,tag.id(),"篮球教学")));
  var pending=inference.suggestions(admin,tenant).getFirst();inference.decide(admin,tenant,pending.id(),new CompanyInferenceService.Decision(UUID.randomUUID(),1,2,"ADOPT"));
  complete(candidate(f,null,"篮球教育"));assertEquals(1,group(f).tags().size());assertEquals("篮球教学",group(f).tags().getFirst().label());assertEquals(1,inference.suggestions(admin,tenant).size());
 }
 @Test void modelContextIncludesPriorInferencesAndErasureFollowsAllInputsNotOnlyQuotedEvidence(){
  complete(candidate(CompanyInformationService.Field.INDUSTRY,null,"体育教育"));var first=group(CompanyInformationService.Field.INDUSTRY).tags().getFirst();
  UUID other=source(space);var job=inference.begin(admin,tenant,List.of(other));assertEquals(1,job.inputs().size());assertEquals(other,job.inputs().getFirst().chunkId());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM company_inference_inputs WHERE run_id=?",Integer.class,job.id()));
  var next=new CompanyInferenceService.Candidate(CompanyInformationService.Field.BUSINESS,null,"篮球培训","",List.of(new CompanyInferenceService.Evidence(other,"篮球培训")));
  inference.finish(job.id(),job.lease(),List.of(next));var second=group(CompanyInformationService.Field.BUSINESS).tags().getFirst();
  db.update("UPDATE knowledge_chunks SET content='' WHERE id=?",chunk);
  assertTrue(group(CompanyInformationService.Field.BUSINESS).tags().isEmpty());
  for(UUID tag:List.of(first.id(),second.id()))assertTrue(db.queryForObject("SELECT v.scrubbed FROM profile_versions v JOIN profile_entries e ON e.id=v.entry_id AND e.revision=v.revision WHERE e.id=?",Boolean.class,tag));
 }
}
