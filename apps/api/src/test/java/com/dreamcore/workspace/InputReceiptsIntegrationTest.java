package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic inputs and parser output only. No provider, parser process or external model is called. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000",
    "dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class InputReceiptsIntegrationTest {
    @Autowired JdbcTemplate db; @Autowired MaterialService materials; @Autowired KnowledgeService knowledge;
    @Autowired ConversationService conversations; @Autowired AgentTaskService agents;
    final JsonMapper json=new JsonMapper();
    UUID tenant,other,owner,reader,space,privateSpace;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();privateSpace=UUID.randomUUID();
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused-synthetic-hash')",id,id+"@example.test","合成输入验证");
        db.update("INSERT INTO tenants(id,name) VALUES (?,'输入验证'),(?,'其他企业')",tenant,other);
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享','SHARED'),(?,?,?,'本人私人','PERSONAL')",space,tenant,owner,privateSpace,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    @AfterEach void cleanup(){
        db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);
        db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);
    }
    MockMultipartFile file(String text){return new MockMultipartFile("file","资料.txt","text/plain",text.getBytes(StandardCharsets.UTF_8));}
    MaterialService.UploadReceipt upload(UUID location,String text){return materials.uploadReceipt(owner,tenant,location,null,null,null,UUID.randomUUID(),file(text));}
    MaterialService.UploadReceipt update(MaterialService.UploadReceipt previous,String text){return materials.uploadReceipt(owner,tenant,previous.workspaceId(),null,previous.id(),previous.currentVersion(),UUID.randomUUID(),file(text));}
    void finish(UUID version,String state,String text,List<String> warnings){finish(version,state,List.of(new DocumentParser.Fragment("L1",text,"TEXT")),warnings);}
    void finish(UUID version,String state,List<DocumentParser.Fragment> fragments,List<String> warnings){
        var job=knowledge.claim();assertNotNull(job);assertEquals(version,job.version());
        knowledge.finish(job,new DocumentParser.Result("synthetic-fixture",state,warnings,fragments));
    }
    ConversationService.Job task(){
        var detail=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"合成检索验证","AGENT");
        var job=conversations.claim();assertNotNull(job);assertEquals(detail.tasks().getLast().id(),job.id());return job;
    }
    IdentityException denied(int status,Runnable action){var error=assertThrows(IdentityException.class,action::run);assertEquals(status,error.status);return error;}

    @Test void exactUploadReceiptSurvivesLaterVersionsAndStillRequiresCurrentMaintenance(){
        UUID request=UUID.randomUUID();
        var original=materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("original bytes"));
        var latest=update(original,"changed bytes");
        var replay=materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("original bytes"));
        assertEquals("EXACT",replay.receiptStatus());assertEquals(original.acceptedVersion(),replay.acceptedVersion());
        assertEquals(original.id(),replay.id());assertEquals(1,replay.version());assertEquals(2,replay.currentVersion());
        assertEquals(ObjectStore.sha256("original bytes".getBytes(StandardCharsets.UTF_8)),replay.acceptedVersion().sha256());
        assertNotEquals(latest.acceptedVersion().id(),replay.acceptedVersion().id());
        assertEquals("IDEMPOTENCY_CONFLICT",denied(409,()->materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("different bytes"))).code);
        assertEquals(2,db.queryForObject("SELECT count(*) FROM material_versions WHERE material_id=?",Integer.class,original.id()));
        db.update("UPDATE workspace_members SET can_maintain=false WHERE workspace_id=? AND account_id=?",space,owner);
        denied(403,()->materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("original bytes")));
    }

    @Test void legacyRequestWithoutVersionEvidenceStaysUnknownAndDoesNotFabricateMapping(){
        UUID request=UUID.randomUUID();var first=materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("same bytes"));
        db.update("DELETE FROM material_upload_receipts WHERE actor_id=? AND request_id=?",owner,request);
        update(first,"same bytes"); // Matching content is not evidence that a particular request created this version.
        var replay=materials.uploadReceipt(owner,tenant,space,null,null,null,request,file("same bytes"));
        assertEquals("HISTORICAL_UNKNOWN",replay.receiptStatus());assertNull(replay.acceptedVersion());
        assertEquals(2,replay.version());assertEquals(2,replay.currentVersion());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM material_upload_receipts WHERE actor_id=? AND request_id=?",Integer.class,owner,request));
    }

    @Test void scopeCoverageDistinguishesMatchesPartialAndUnreadyWithoutCountingPrivateOrForeignFiles(){
        var ready=upload(space,"ready");finish(ready.acceptedVersion().id(),"READY","match ready",List.of());
        var partial=upload(space,"partial");finish(partial.acceptedVersion().id(),"PARTIAL","match partial",List.of("TABLE_TRUNCATED"));
        upload(space,"waiting");upload(privateSpace,"not visible in aggregate");
        UUID foreignSpace=UUID.randomUUID(),foreignActor=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'外部合成用户','unused-synthetic-hash')",foreignActor,foreignActor+"@example.test");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,foreignActor);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'外部','PERSONAL')",foreignSpace,other,foreignActor);
        var foreign=materials.uploadReceipt(foreignActor,other,foreignSpace,null,null,null,UUID.randomUUID(),file("foreign pending"));
        var result=knowledge.search(reader,tenant,null,"no-match",0,20);
        assertEquals("NO_MATCH",result.matchStatus());assertTrue(result.items().isEmpty());
        var coverage=result.coverage();assertEquals("AUTHORIZED_SHARED",coverage.scope());assertEquals("PARTIAL",coverage.status());
        assertEquals(3,coverage.totalVersions());assertEquals(2,coverage.searchableVersions());assertEquals(1,coverage.partialVersions());assertEquals(1,coverage.notReadyVersions());assertEquals("NOT_ASSESSED",coverage.relevance());
        assertFalse(json.writeValueAsString(result).contains(privateSpace.toString()));assertFalse(json.writeValueAsString(result).contains(foreign.id().toString()));
        assertEquals("MATCHED",knowledge.search(reader,tenant,space,"match",50,20).matchStatus()); // Empty page is not no matches.
    }

    @Test void latestUnreadyVersionDoesNotFallBackToOlderReadyContent(){
        var first=upload(space,"old");finish(first.acceptedVersion().id(),"READY","oldmarker",List.of());
        var second=update(first,"new");
        var result=knowledge.search(reader,tenant,space,"oldmarker",0,20);
        assertTrue(result.items().isEmpty());assertEquals("NO_MATCH",result.matchStatus());assertEquals("NOT_READY",result.coverage().status());
        var version=result.coverage().versions().getFirst();assertEquals(second.acceptedVersion().id(),version.versionId());assertEquals("QUEUED",version.status());
        assertEquals(2,version.version());
    }

    @Test void attemptPinsOriginalAndParseGenerationButNewMaterialsCanJoinAndRetryCanUseCurrentVersion(){
        var original=upload(space,"one");finish(original.acceptedVersion().id(),"READY","marker original",List.of());
        var job=task();var first=agents.searchResult(job.id(),job.token(),"marker");var old=first.items().getFirst();
        UUID oldRun=knowledge.citation(owner,tenant,old.id()).runId();
        var replacement=update(original,"two");finish(replacement.acceptedVersion().id(),"READY","marker replacement",List.of());
        knowledge.request(owner,tenant,space,original.id(),original.acceptedVersion().id(),UUID.randomUUID(),1);
        finish(original.acceptedVersion().id(),"READY","marker reparsed",List.of());
        var another=upload(space,"new material");finish(another.acceptedVersion().id(),"READY","marker additional",List.of());
        var repeated=agents.searchResult(job.id(),job.token(),"marker");
        assertEquals(2,repeated.items().size());assertTrue(repeated.items().contains(old));
        assertFalse(repeated.items().stream().anyMatch(i->i.content().contains("replacement") || i.content().contains("reparsed")));
        var fixed=repeated.coverage().versions().stream().filter(v->v.materialId().equals(original.id())).findFirst().orElseThrow();
        assertTrue(fixed.pinned());assertEquals(oldRun,fixed.runId());assertEquals(1,fixed.generation());assertEquals(1,fixed.version());
        assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_task_material_versions WHERE task_id=? AND attempt_id=?",Integer.class,job.id(),job.token()));
        var current=knowledge.search(owner,tenant,space,"replacement",0,20);assertEquals(2,current.items().getFirst().version());
        int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());
        conversations.action(owner,tenant,job.conversation(),job.id(),UUID.randomUUID(),revision,"CANCEL");
        conversations.action(owner,tenant,job.conversation(),job.id(),UUID.randomUUID(),revision+1,"RETRY");
        var retry=conversations.claim();assertNotEquals(job.token(),retry.token());
        assertEquals(2,agents.search(retry.id(),retry.token(),"replacement").getFirst().version());
    }

    @Test void revocationInvalidatesPinnedReadsAndCoverageContainsNoUnauthorizedCounts(){
        var original=upload(space,"one");finish(original.acceptedVersion().id(),"READY","marker",List.of());
        var job=task();agents.search(job.id(),job.token(),"marker");
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(404,()->agents.searchResult(job.id(),job.token(),"marker"));
        var result=knowledge.search(owner,tenant,null,"marker",0,20);
        assertEquals("EMPTY",result.coverage().status());assertEquals(0,result.coverage().totalVersions());assertTrue(result.coverage().versions().isEmpty());
        assertFalse(json.writeValueAsString(result).contains(original.id().toString()));
        denied(404,()->knowledge.search(owner,tenant,space,"marker",0,20));
        denied(403,()->knowledge.search(owner,other,null,"marker",0,20));
    }

    @Test void callbackBoundsEncodedBytesAndWarningsAndGrantsOnlyReturnedChunks(){
        var original=upload(space,"one");String content="x"+"\u0001".repeat(3999);
        var warnings=Collections.nCopies(20,"long-warning-".repeat(20));
        finish(original.acceptedVersion().id(),"PARTIAL",List.of(new DocumentParser.Fragment("L1",content,"TEXT"),new DocumentParser.Fragment("L2",content,"TEXT"),new DocumentParser.Fragment("L3",content,"TEXT")),warnings);
        var job=task();var result=agents.searchResult(job.id(),job.token(),"x");
        assertTrue(json.writeValueAsBytes(result).length<=60*1024);assertTrue(result.hasMore());assertEquals(2,result.items().size());
        assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_agent_grants WHERE task_id=? AND attempt_id=?",Integer.class,job.id(),job.token()));
        assertEquals(4,result.coverage().versions().getFirst().warnings().size());
        assertTrue(result.coverage().versions().getFirst().warnings().stream().allMatch(w->w.length()<=64));
    }
}
