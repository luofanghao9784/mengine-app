package com.dreamcore.workspace;
import com.dreamcore.workspace.profile.*;import com.dreamcore.workspace.material.*;
import java.util.*;import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.mock.web.MockMultipartFile;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.tasks.agent-mode=verification","dreamcore.company-analysis.enabled=false"})
abstract class CompanyAnalysisFixture {
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired CompanyAnalysisQueue queue;@Autowired CompanyInferenceService inference;@Autowired CompanyInformationService information;
 UUID tenant,admin,reader,space,personal,chunk;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'自动企业整理合成数据')",tenant);
  for(UUID a:List.of(admin,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'test-only')",a,a+"@example.test","合成人员");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'全员共享','SHARED'),(?,?,?,'私人','PERSONAL')",space,tenant,admin,personal,tenant,admin);
  for(UUID a:List.of(admin,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,a);
  chunk=source(space);
 }
 UUID source(UUID location){
  var m=materials.upload(admin,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","企业介绍.txt","text/plain","本企业从事体育教育。".getBytes(java.nio.charset.StandardCharsets.UTF_8)));UUID version=materials.detail(admin,tenant,location,m.id(),0,10).versions().getFirst().id();UUID run=db.queryForObject("SELECT id FROM knowledge_runs WHERE version_id=?",UUID.class,version),id=UUID.randomUUID();db.update("UPDATE knowledge_runs SET status='READY',finished_at=now() WHERE id=?",run);
  db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'第1段','TEXT','本企业从事体育教育。')",id,tenant,location,m.id(),version,run);return id;
 }
 CompanyInferenceService.Job claim(){queue.discover();return queue.claim(tenant);}
 CompanyAnalysisRuntime.Descriptor descriptor(){return new CompanyAnalysisRuntime.Descriptor("1.0","synthetic-v1",true,"verification");}
 CompanyAnalysisRuntime.Result result(CompanyInferenceService.Job job,String outcome){return new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",job.id(),job.lease(),outcome,outcome.equals("COMPLETE")?null:"COMPANY_ANALYSIS_FAILED",outcome.equals("COMPLETE")?List.of(new CompanyInferenceService.Candidate(CompanyInformationService.Field.INDUSTRY,null,"体育教育","",List.of(new CompanyInferenceService.Evidence(job.inputs().getFirst().chunkId(),"体育教育")))):List.of(),"synthetic-company",1,12L,3L);}
 String state(){return db.queryForObject("SELECT state FROM company_analysis_items WHERE chunk_id=?",String.class,chunk);}
 void due(){db.update("UPDATE company_analysis_items SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=?",tenant);}
 @AfterEach void finishFixture(){db.update("UPDATE knowledge_runs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE company_analysis_attempts SET state='CANCELLED' WHERE tenant_id=? AND state IN ('CLAIMED','DISPATCHED')",tenant);db.update("UPDATE company_inference_runs SET state='CANCELLED' WHERE tenant_id=? AND state='RUNNING'",tenant);}
}
