package com.dreamcore.workspace;

import com.dreamcore.workspace.departure.DepartureResidualCleanup;
import com.dreamcore.workspace.profile.ProfileService;
import com.dreamcore.workspace.retention.RetentionClock;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

/** Real PostgreSQL and production cleanup bean; no model, network, or departure impersonation. */
@SpringBootTest(properties={"dreamcore.object-lifecycle.enabled=false","dreamcore.tasks.initial-delay-ms=3600000",
    "dreamcore.lifecycle.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000",
    "dreamcore.plans.initial-delay-ms=3600000","dreamcore.departure.initial-delay-ms=3600000"})
class DepartureResidualCleanupIntegrationTest {
    @Autowired DepartureResidualCleanup cleanup;
    @Autowired ProfileService profiles;
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean RetentionClock clock;
    Instant now;
    Scope s;
    static final String SECRET="合成残余私人正文";
    record Scope(UUID tenant,UUID owner,UUID other,UUID personal,UUID otherPersonal,UUID shared) {}
    record Plan(UUID id,UUID request) {}
    record Source(UUID id,UUID submission) {}
    record Publication(UUID id,UUID run,UUID materialVersion) {}

    @BeforeEach void fixture(){now=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);when(clock.now()).thenReturn(now);s=scope();}
    @org.junit.jupiter.api.AfterEach void retireFixtureQueues(){
        db.update("UPDATE export_batches SET state='REMOVED',cleanup_state='COMPLETE',lease_token=NULL,lease_until=NULL WHERE tenant_id=?",s.tenant());
        db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",s.tenant());
        db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",s.tenant());
    }
    Timestamp at(Instant value){return Timestamp.from(value);}
    Scope scope(){
        var v=new Scope(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID());
        for(UUID actor:List.of(v.owner(),v.other()))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'synthetic-unused-password')",actor,actor+"@residual.test","退出清理合成用户");
        db.update("INSERT INTO tenants(id,name) VALUES (?,'残余清理合成企业')",v.tenant());
        for(UUID actor:List.of(v.owner(),v.other()))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",v.tenant(),actor);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'本人个人','PERSONAL'),(?,?,?,'他人个人','PERSONAL'),(?,?,?,'共享资产','SHARED')",v.personal(),v.tenant(),v.owner(),v.otherPersonal(),v.tenant(),v.other(),v.shared(),v.tenant(),v.owner());
        for(UUID actor:List.of(v.owner(),v.other()))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",v.tenant(),v.shared(),actor);
        db.update("INSERT INTO tenant_governance(tenant_id,owner_id,revision) VALUES (?,?,7)",v.tenant(),v.owner());
        db.update("INSERT INTO governance_capabilities(tenant_id,account_id,capability,granted_by) VALUES (?,?,'MEMBER_OFFBOARD',?)",v.tenant(),v.owner(),v.owner());
        return v;
    }
    UUID profile(Scope scope,UUID owner,String kind,UUID workspace){
        if(kind.equals("WORKSPACE")&&workspace.equals(scope.personal()))return profiles.create(owner,scope.tenant(),ProfileService.Scope.WORKSPACE,workspace,"private-space-"+UUID.randomUUID(),ProfileService.Kind.FACT,new ProfileService.Content(SECRET,SECRET,ProfileService.Status.ACTIVE,null),UUID.randomUUID()).id();
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO profile_entries(id,tenant_id,scope,workspace_id,account_id,entry_key,kind,created_by,revision) VALUES (?,?,?,?,?,?,'PREFERENCE',?,2)",id,scope.tenant(),kind,workspace,kind.equals("PERSONAL")?owner:null,"secret-key-"+id,owner);
        for(int revision:List.of(1,2))db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES (?,?,?,?,?,?,'ACTIVE',?)",UUID.randomUUID(),scope.tenant(),id,revision,SECRET,SECRET,owner);
        return id;
    }
    UUID departure(Scope scope,UUID account,Instant deadline,String state,boolean stopped){
        UUID id=UUID.randomUUID();db.update("INSERT INTO departure_executions(id,tenant_id,kind,target_account_id,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_tenant_status,stop_complete) VALUES (?,?,?,?,?,?,'合成执行事实',?,3,?,?,'ACTIVE',?)",id,scope.tenant(),account==null?"TENANT_EXIT":"MEMBER_OFFBOARD",account,state,scope.owner(),account==null?"TENANT_EXIT_WINDOW":"OFFBOARD_ISOLATION",at(deadline.minus(Duration.ofDays(30))),at(deadline),stopped);return id;
    }
    Plan plan(Scope scope,UUID actor,UUID workspace){
        UUID id=UUID.randomUUID(),key=UUID.randomUUID();
        db.update("INSERT INTO ongoing_plans(id,tenant_id,workspace_id,owner_id,status,runtime_state,goal,purpose,query,behavior,material_events,time_zone,min_interval_seconds,max_runs_per_day,max_total_runs,expires_at,next_due,retry_requested) VALUES (?,?,?,?,'ACTIVE','WAITING_CAPABILITY',?,?,?,'ANALYZE',true,'Asia/Shanghai',60,2,8,?,?,true)",id,scope.tenant(),workspace,actor,SECRET,SECRET,SECRET,at(now.plus(Duration.ofDays(10))),at(now.plusSeconds(60)));
        for(int revision:List.of(1,2))db.update("INSERT INTO ongoing_plan_versions(plan_id,revision,configuration,changed_by) VALUES (?,?,jsonb_build_object('goal',?::text,'purpose',?::text,'query',?::text,'workspaceId',?::text),?)",id,revision,SECRET,SECRET,SECRET,workspace.toString(),actor);
        request(actor,key,"PLAN_CREATE",id);
        db.update("INSERT INTO ongoing_plan_receipts(actor_id,request_id,receipt) VALUES (?,?,jsonb_build_object('id',?::text,'revision',1,'configuration',jsonb_build_object('goal',?::text,'purpose',?::text,'query',?::text)))",actor,key,id.toString(),SECRET,SECRET,SECRET);
        return new Plan(id,key);
    }
    Source source(Scope scope,UUID actor,UUID workspace){
        UUID id=UUID.randomUUID(),submission=UUID.randomUUID();
        db.update("INSERT INTO business_sources(id,tenant_id,workspace_id,name,description,responsible_id,created_by) VALUES (?,?,?,?,?,?,?)",id,scope.tenant(),workspace,SECRET,SECRET,actor,actor);
        for(int revision:List.of(0,1))db.update("INSERT INTO business_source_config_versions(source_id,revision,settings,changed_by) VALUES (?,?,jsonb_build_object('name',?::text,'description',?::text,'responsibleId',?::text),?)",id,revision,SECRET,SECRET,actor.toString(),actor);
        db.update("INSERT INTO business_source_submissions(id,tenant_id,workspace_id,source_id,coverage_from,coverage_through,note,submitted_by) VALUES (?,?,?,?,'2026-01-01','2026-01-31',?,?)",submission,scope.tenant(),workspace,id,SECRET,actor);
        return new Source(id,submission);
    }
    UUID task(Scope scope,UUID actor,UUID workspace){
        UUID conversation=UUID.randomUUID(),task=UUID.randomUUID();
        db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,?)",conversation,scope.tenant(),workspace,actor,SECRET);
        db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,public_query,mode,status,attempt,execution_class,finished_at) VALUES (?,?,?,?,?,?,?,'AGENT','SUCCEEDED',1,'verification',now())",task,scope.tenant(),workspace,conversation,actor,SECRET,"https://example.test/private-query-SECRET");return task;
    }
    UUID batch(Scope scope,UUID actor,UUID workspace){
        UUID id=UUID.randomUUID(),generation=UUID.randomUUID();
        db.update("INSERT INTO export_batches(id,tenant_id,owner_id,workspace_id,scope,retention_days,state,requested_count,lease_token,lease_until,generation,retention_anchor,retention_deadline,retention_policy_revision) VALUES (?,?,?,?,'ENTERPRISE',7,'GENERATING',1,?,?,?,?,?,4)",id,scope.tenant(),actor,workspace,UUID.randomUUID(),at(now.plusSeconds(300)),generation,at(now.minus(Duration.ofDays(1))),at(now.plus(Duration.ofDays(6))));
        db.update("INSERT INTO export_batch_items(batch_id,ordinal,object_id,version,format,state,title,archive_path,sha256) VALUES (?,1,?,1,'docx','INCLUDED',?,?,?)",id,UUID.randomUUID(),SECRET,"private/SECRET.docx","a".repeat(64));
        db.update("INSERT INTO export_archive_chunks(batch_id,generation,ordinal,content) VALUES (?,?,0,?)",id,generation,SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8));return id;
    }
    Publication publication(Scope scope,UUID actor,UUID workspace){
        return new TransactionTemplate(transactions).execute(status->{
            UUID material=UUID.randomUUID(),version=UUID.randomUUID(),run=UUID.randomUUID(),document=UUID.randomUUID(),publication=UUID.randomUUID(),task=task(scope,actor,workspace);
            UUID conversation=db.queryForObject("SELECT conversation_id FROM conversation_tasks WHERE id=?",UUID.class,task);
            db.update("INSERT INTO materials(id,tenant_id,workspace_id,name,created_by) VALUES (?,?,?,?,?)",material,scope.tenant(),workspace,SECRET,actor);
            db.update("INSERT INTO material_versions(id,tenant_id,workspace_id,material_id,number,filename,size_bytes,sha256,object_id,created_by) VALUES (?,?,?,?,1,?,1,?,?,?)",version,scope.tenant(),workspace,material,"合成发布SECRET.docx","a".repeat(64),UUID.randomUUID(),actor);
            db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status,warnings) VALUES (?,?,?,?,?,1,?,'READY',?)",run,scope.tenant(),workspace,material,version,actor,SECRET);
            db.update("INSERT INTO private_documents(id,tenant_id,owner_id,workspace_id,source_workspace_id,source_conversation_id,source_task_id,revision) VALUES (?,?,?,?,?,?,?,1)",document,scope.tenant(),actor,workspace,workspace,conversation,task);
            db.update("INSERT INTO private_document_versions(tenant_id,document_id,number,title,body) VALUES (?,?,1,?,?)",scope.tenant(),document,SECRET,SECRET);
            db.update("INSERT INTO document_publications(id,tenant_id,actor_id,document_id,document_version,workspace_id,material_id,material_version_id,material_version,format,filename,sha256) VALUES (?,?,?,?,1,?,?,?,1,'docx',?,?)",publication,scope.tenant(),actor,document,workspace,material,version,"合成发布SECRET.docx","a".repeat(64));
            return new Publication(publication,run,version);
        });
    }
    UUID issue(Scope scope,UUID actor,UUID workspace){
        UUID asset=UUID.randomUUID(),version=UUID.randomUUID(),issue=UUID.randomUUID();
        db.update("INSERT INTO evaluation_assets(id,tenant_id,workspace_id,kind,created_by) VALUES (?,?,?,'SAMPLE',?)",asset,scope.tenant(),workspace,actor);
        db.update("INSERT INTO evaluation_asset_versions(id,asset_id,revision,content,evidence,origin_key,mode,created_by) VALUES (?,?,1,'{}','{\"items\":[]}',?,'SYNTHETIC',?)",version,asset,"synthetic:"+"a".repeat(64),actor);
        db.update("INSERT INTO evaluation_issues(id,tenant_id,workspace_id,sample_version,title,category,impact,next_action,created_by) VALUES (?,?,?,?,?,'CONTENT',?,?,?)",issue,scope.tenant(),workspace,version,SECRET,SECRET,SECRET,actor);
        db.update("INSERT INTO evaluation_issue_events(id,issue_id,revision,status,note,evidence,actor_id) VALUES (?,?,1,'OPEN',?,'{\"items\":[]}',?)",UUID.randomUUID(),issue,SECRET,actor);return issue;
    }
    void request(UUID actor,UUID key,String operation,UUID target){db.update("INSERT INTO identity_requests(actor_id,request_id,operation,fingerprint,target_id) VALUES (?,?,?,?,?)",actor,key,operation,"b".repeat(64),target);}
    UUID preference(Scope scope,UUID actor,UUID task){
        UUID key=UUID.randomUUID();request(actor,key,"RECOMMENDATION_SETTINGS",scope.tenant());
        db.update("INSERT INTO recommendation_settings(tenant_id,actor_id,enabled) VALUES (?,?,true)",scope.tenant(),actor);
        db.update("INSERT INTO recommendation_receipts(actor_id,request_id,receipt) VALUES (?,?,jsonb_build_object('tenantId',?::text,'revision',1,'enabled',true))",actor,key,scope.tenant().toString());
        db.update("INSERT INTO recommendation_presentations(tenant_id,actor_id,task_id,task_revision,attempt,fingerprint,method,presentation,settings_revision) VALUES (?,?,?,0,1,?,'{}','{\"renderer\":\"basic-v1\",\"style\":\"TABLE_FIRST\",\"profileRevision\":2}',1)",scope.tenant(),actor,task,"c".repeat(64));return key;
    }
    void usage(Scope scope,UUID task){
        UUID attempt=UUID.randomUUID();db.update("INSERT INTO agent_attempt_usage(attempt_id,task_id,tenant_id,workspace_id,attempt_number,execution_class,status,metering_enabled) SELECT ?,id,tenant_id,workspace_id,1,'verification','SUCCEEDED',false FROM conversation_tasks WHERE id=?",attempt,task);
        db.update("INSERT INTO agent_model_requests(task_id,attempt_id,sequence,max_output_tokens,outcome,input_tokens,output_tokens) VALUES (?,?,1,256,'RETURNED',120,30)",task,attempt);
        db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES (?,?,'DEPARTURE_EXECUTE',?,'SUCCESS')",scope.owner(),scope.tenant(),task);
    }
    int converge(UUID account){for(int n=1;n<=20;n++)if(cleanup.clean(s.tenant(),account))return n;throw new AssertionError("Cleanup did not converge within bounded fixture passes");}
    String text(String table,String field,UUID id){return db.queryForObject("SELECT "+field+" FROM "+table+" WHERE id=?",String.class,id);}
    void profileErased(UUID id){assertEquals(0,db.queryForObject("SELECT count(*) FROM profile_versions WHERE entry_id=? AND (value<>'' OR provenance<>'' OR status<>'WITHDRAWN')",Integer.class,id));assertEquals("removed-"+id,text("profile_entries","entry_key",id));}

    @Test void noEffectiveStoppedAndDueFactMeansNoErasure(){
        UUID profile=profile(s,s.owner(),"PERSONAL",null);assertFalse(cleanup.clean(s.tenant(),s.owner()));
        UUID execution=departure(s,s.owner(),now.plusSeconds(1),"CLEANING",true);assertFalse(cleanup.clean(s.tenant(),s.owner()));
        when(clock.now()).thenReturn(now.plusSeconds(1));db.update("UPDATE departure_executions SET stop_complete=false WHERE id=?",execution);assertFalse(cleanup.clean(s.tenant(),s.owner()));
        db.update("UPDATE departure_executions SET stop_complete=true,state='CANCELLED' WHERE id=?",execution);assertFalse(cleanup.clean(s.tenant(),s.owner()));
        assertEquals(2,db.queryForObject("SELECT count(*) FROM profile_versions WHERE entry_id=? AND value=?",Integer.class,profile,SECRET));assertEquals(now.plusSeconds(1),db.queryForObject("SELECT deadline FROM departure_executions WHERE id=?",Timestamp.class,execution).toInstant());
    }
    @Test void offboardingErasesOnlyTheOwnersPrivateScopeAndKeepsSharedAssetsAndOthers(){
        Scope foreign=scope();UUID mine=profile(s,s.owner(),"PERSONAL",null),personalWorkspace=profile(s,s.owner(),"WORKSPACE",s.personal()),other=profile(s,s.other(),"PERSONAL",null),shared=profile(s,s.owner(),"WORKSPACE",s.shared()),tenantProfile=profile(s,s.owner(),"TENANT",null),foreignProfile=profile(foreign,foreign.owner(),"PERSONAL",null);
        Plan ownPlan=plan(s,s.owner(),s.shared()),otherPlan=plan(s,s.other(),s.shared());Source ownSource=source(s,s.owner(),s.personal()),sharedSource=source(s,s.owner(),s.shared()),otherSource=source(s,s.other(),s.otherPersonal());
        Publication sharedCopy=publication(s,s.owner(),s.shared());UUID mineBatch=batch(s,s.owner(),s.shared()),otherBatch=batch(s,s.other(),s.shared());
        departure(s,s.owner(),now,"CLEANING",true);assertTrue(converge(s.owner())>=2);profileErased(mine);profileErased(personalWorkspace);
        for(UUID id:List.of(other,shared,tenantProfile,foreignProfile))assertEquals(SECRET,db.queryForObject("SELECT value FROM profile_versions WHERE entry_id=? AND revision=2",String.class,id));
        assertEquals("",text("ongoing_plans","query",ownPlan.id()));assertEquals(SECRET,text("ongoing_plans","query",otherPlan.id()));assertEquals("",text("business_sources","description",ownSource.id()));assertEquals("",text("business_source_submissions","note",ownSource.submission()));
        for(Source src:List.of(sharedSource,otherSource))assertEquals(SECRET,text("business_sources","description",src.id()));
        assertEquals("合成发布SECRET.docx",text("document_publications","filename",sharedCopy.id()));assertEquals(SECRET,text("knowledge_runs","warnings",sharedCopy.run()));assertEquals("REVOKED",text("export_batches","state",mineBatch));assertEquals("GENERATING",text("export_batches","state",otherBatch));
    }
    @Test void tenantExitScrubsHistoricalTextAndReceiptsAndActualV26ChunksButKeepsMinimalFacts(){
        UUID profile=profile(s,s.owner(),"TENANT",null),task=task(s,s.owner(),s.shared()),issue=issue(s,s.owner(),s.shared());Plan plan=plan(s,s.owner(),s.shared());Source source=source(s,s.owner(),s.shared());Publication publication=publication(s,s.owner(),s.shared());UUID batch=batch(s,s.owner(),s.shared()),preferenceKey=preference(s,s.owner(),task);usage(s,task);
        Map<String,Object> batchBefore=db.queryForMap("SELECT retention_anchor,retention_deadline,retention_policy_revision FROM export_batches WHERE id=?",batch);int requests=db.queryForObject("SELECT count(*) FROM identity_requests WHERE actor_id=?",Integer.class,s.owner());Map<String,Object> usageBefore=db.queryForMap("SELECT input_tokens,output_tokens,outcome FROM agent_model_requests WHERE task_id=?",task);
        var requestFacts=db.queryForList("SELECT actor_id,request_id,operation,fingerprint,target_id FROM identity_requests WHERE actor_id=? ORDER BY request_id",s.owner());var auditFacts=db.queryForList("SELECT * FROM identity_audit WHERE tenant_id=? ORDER BY id",s.tenant());var attemptFacts=db.queryForList("SELECT * FROM agent_attempt_usage WHERE task_id=?",task);
        UUID execution=departure(s,null,now,"CLEANING",true);assertTrue(converge(null)>=2);profileErased(profile);
        assertEquals("STOPPED",text("ongoing_plans","status",plan.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM ongoing_plan_versions WHERE plan_id=? AND configuration::text LIKE ?",Integer.class,plan.id(),"%"+SECRET+"%"));assertFalse(db.queryForObject("SELECT receipt::text FROM ongoing_plan_receipts WHERE actor_id=? AND request_id=?",String.class,s.owner(),plan.request()).contains(SECRET));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM business_source_config_versions WHERE source_id=? AND settings::text LIKE ?",Integer.class,source.id(),"%"+SECRET+"%"));assertEquals("",text("business_source_submissions","note",source.submission()));assertNull(text("conversation_tasks","public_query",task));assertEquals("",text("knowledge_runs","warnings",publication.run()));assertEquals("removed",text("document_publications","filename",publication.id()));assertEquals("",text("evaluation_issues","impact",issue));assertEquals("",db.queryForObject("SELECT note FROM evaluation_issue_events WHERE issue_id=?",String.class,issue));
        assertEquals("{}",db.queryForObject("SELECT presentation::text FROM recommendation_presentations WHERE task_id=?",String.class,task));assertEquals("false",db.queryForObject("SELECT receipt->>'enabled' FROM recommendation_receipts WHERE actor_id=? AND request_id=?",String.class,s.owner(),preferenceKey));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM export_archive_chunks WHERE batch_id=?",Integer.class,batch));assertNull(db.queryForObject("SELECT title FROM export_batch_items WHERE batch_id=?",String.class,batch));assertNull(db.queryForObject("SELECT archive_path FROM export_batch_items WHERE batch_id=?",String.class,batch));assertNull(db.queryForObject("SELECT sha256 FROM export_batch_items WHERE batch_id=?",String.class,batch));assertNull(db.queryForObject("SELECT lease_token FROM export_batches WHERE id=?",UUID.class,batch));assertEquals("COMPLETE",text("export_batches","cleanup_state",batch));assertEquals(SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,db.queryForObject("SELECT removed_bytes FROM export_batches WHERE id=?",Long.class,batch));
        assertEquals(batchBefore,db.queryForMap("SELECT retention_anchor,retention_deadline,retention_policy_revision FROM export_batches WHERE id=?",batch));assertEquals(requests,db.queryForObject("SELECT count(*) FROM identity_requests WHERE actor_id=?",Integer.class,s.owner()));assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=?",Integer.class,s.tenant()));assertEquals(usageBefore,db.queryForMap("SELECT input_tokens,output_tokens,outcome FROM agent_model_requests WHERE task_id=?",task));assertEquals(requestFacts,db.queryForList("SELECT actor_id,request_id,operation,fingerprint,target_id FROM identity_requests WHERE actor_id=? ORDER BY request_id",s.owner()));assertEquals(auditFacts,db.queryForList("SELECT * FROM identity_audit WHERE tenant_id=? ORDER BY id",s.tenant()));assertEquals(attemptFacts,db.queryForList("SELECT * FROM agent_attempt_usage WHERE task_id=?",task));assertEquals(s.owner(),db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,s.tenant()));assertEquals(7,db.queryForObject("SELECT revision FROM tenant_governance WHERE tenant_id=?",Integer.class,s.tenant()));assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_capabilities WHERE tenant_id=?",Integer.class,s.tenant()));assertEquals(now,db.queryForObject("SELECT deadline FROM departure_executions WHERE id=?",Timestamp.class,execution).toInstant());
    }
    @Test void moreThanOneHundredRowsAndMoreThanFiveBatchesConvergeWithoutPrematureCompletion(){
        for(int n=0;n<105;n++)profile(s,s.owner(),"PERSONAL",null);for(int n=0;n<7;n++)batch(s,s.owner(),s.shared());departure(s,s.owner(),now,"CLEANING",true);
        assertFalse(cleanup.clean(s.tenant(),s.owner()));assertEquals(110,db.queryForObject("SELECT count(*) FROM profile_versions WHERE tenant_id=? AND value<>''",Integer.class,s.tenant()));assertEquals(2,db.queryForObject("SELECT count(*) FROM export_batches WHERE tenant_id=? AND cleanup_state<>'COMPLETE'",Integer.class,s.tenant()));
        assertEquals(3,converge(s.owner()));assertEquals(0,db.queryForObject("SELECT count(*) FROM profile_versions WHERE tenant_id=? AND value<>''",Integer.class,s.tenant()));assertEquals(0,db.queryForObject("SELECT count(*) FROM export_archive_chunks c JOIN export_batches b ON b.id=c.batch_id WHERE b.tenant_id=?",Integer.class,s.tenant()));assertTrue(cleanup.clean(s.tenant(),s.owner()));
    }
    @Test void actualDatabaseFailureRollsBackEarlierTablesAndRetryKeepsTheOriginalDeadline(){
        UUID profile=profile(s,s.owner(),"PERSONAL",null);Plan plan=plan(s,s.owner(),s.personal());Source source=source(s,s.owner(),s.personal());UUID execution=departure(s,s.owner(),now,"CLEANING",true);String suffix=UUID.randomUUID().toString().replace("-","");String fn="residual_fail_"+suffix,tr="residual_fail_trigger_"+suffix;
        db.execute("CREATE FUNCTION "+fn+"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='"+source.id()+"'::uuid THEN RAISE EXCEPTION 'injected residual cleanup failure'; END IF; RETURN NEW; END $$");db.execute("CREATE TRIGGER "+tr+" BEFORE UPDATE ON business_sources FOR EACH ROW EXECUTE FUNCTION "+fn+"()");
        try{assertThrows(DataAccessException.class,()->cleanup.clean(s.tenant(),s.owner()));assertEquals(SECRET,db.queryForObject("SELECT value FROM profile_versions WHERE entry_id=? AND revision=1",String.class,profile));assertEquals(SECRET,text("ongoing_plans","query",plan.id()));assertEquals(SECRET,text("business_sources","description",source.id()));assertEquals(now,db.queryForObject("SELECT deadline FROM departure_executions WHERE id=?",Timestamp.class,execution).toInstant());}
        finally{db.execute("DROP TRIGGER "+tr+" ON business_sources");db.execute("DROP FUNCTION "+fn+"()");}
        when(clock.now()).thenReturn(now.plus(Duration.ofDays(10)));assertEquals(2,converge(s.owner()));profileErased(profile);assertEquals("",text("ongoing_plans","query",plan.id()));assertEquals(now,db.queryForObject("SELECT deadline FROM departure_executions WHERE id=?",Timestamp.class,execution).toInstant());
    }
}
