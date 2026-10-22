package com.dreamcore.workspace;

import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.lifecycle.*;
import com.dreamcore.workspace.identity.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Real PostgreSQL/platform authorization + synthetic upstream HTTP contract, not a semantic quality test. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000",
    "dreamcore.weknora.enabled=true","dreamcore.weknora.initial-delay-ms=3600000","dreamcore.weknora.api-key=synthetic-key"})
class WeKnoraIntegrationTest {
    static final JsonMapper JSON=new JsonMapper();
    static HttpServer server;
    static final Map<String,String> documents=new java.util.concurrent.ConcurrentHashMap<>();
    static final AtomicInteger creates=new AtomicInteger(), searches=new AtomicInteger();
    static volatile JsonNode lastSearch;
    static volatile Runnable duringSearch=()->{};
    static volatile String behavior="normal";
    static {
        try {
            server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/",exchange->{
                try {
                    if(!"synthetic-key".equals(exchange.getRequestHeaders().getFirst("X-API-Key")))throw new IllegalStateException();
                    String path=exchange.getRequestURI().getPath();Object result;int status=200;
                    if(path.endsWith("/knowledge/manual")){
                        var payload=JSON.readTree(exchange.getRequestBody().readAllBytes());
                        if(!"publish".equals(payload.path("status").asText()))throw new IllegalStateException("manual knowledge defaults to an unindexed draft");
                        creates.incrementAndGet();String kb=path.split("/")[4];String id=UUID.randomUUID().toString();documents.put(id,kb);
                        if(behavior.equals("create-unknown")){status=503;result=Map.of("success",false);}
                        else result=Map.of("success",true,"data",Map.of("id",id,"knowledge_base_id",kb,"parse_status",behavior.equals("pending")?"processing":"completed"));
                    } else if(path.endsWith("/hybrid-search")){
                        searches.incrementAndGet();lastSearch=JSON.readTree(exchange.getRequestBody().readAllBytes());duringSearch.run();
                        var hits=new ArrayList<Object>();
                        for(var id:lastSearch.path("knowledge_ids"))hits.add(Map.of("knowledge_id",behavior.equals("foreign")?"foreign-document":id.asText(),"content","REMOTE MUST NEVER BE RETURNED"));
                        result=Map.of("success",true,"data",hits,"meta",Map.of("rerank",Map.of("applied",!behavior.equals("no-rerank"))));
                    } else {
                        String id=path.substring(path.lastIndexOf('/')+1);
                        if(exchange.getRequestMethod().equals("DELETE")){documents.remove(id);result=Map.of("success",true);}
                        else if(!documents.containsKey(id)){status=404;result=Map.of("success",false);}
                        else result=Map.of("success",true,"data",Map.of("id",id,"knowledge_base_id",documents.get(id),"parse_status","completed"));
                    }
                    byte[] bytes=JSON.writeValueAsBytes(result);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);
                } finally {exchange.close();}
            });server.start();
        }catch(Exception e){throw new ExceptionInInitializerError(e);}
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r){r.add("dreamcore.weknora.url",()->"http://127.0.0.1:"+server.getAddress().getPort());}
    @Autowired MaterialLifecycleService lifecycle;@Autowired MaterialCleanupService cleanup;
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired WeKnoraIndexWorker worker;
    UUID tenant,owner,reader,space;String kb;
    @BeforeEach void fixture(){
        behavior="normal";duringSearch=()->{};creates.set(0);searches.set(0);documents.clear();
        // Isolate both parser and index worker queues from previous test fixtures.
        db.update("UPDATE knowledge_runs SET status='FAILED',warnings='TEST_FIXTURE_RESET',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE status IN ('QUEUED','RUNNING')");
        db.update("UPDATE knowledge_index_targets SET enabled=false");
        db.update("UPDATE knowledge_remote_index SET state='DELETED',lease_until=NULL");
        tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();kb="kb-"+tenant;
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused')",id,id+"@example.test","合成检索测试");
        db.update("INSERT INTO tenants(id,name) VALUES (?,'合成检索企业')",tenant);
        for(UUID id:List.of(owner,reader))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED')",space,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
        db.update("INSERT INTO knowledge_index_targets(tenant_id,knowledge_base_id,enabled) VALUES (?,?,true)",tenant,kb);
    }
    UUID parsed(String text){
        var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","synthetic.txt","text/plain",text.getBytes(StandardCharsets.UTF_8)));
        var job=knowledge.claim();assertNotNull(job);assertEquals(tenant,job.tenant());
        knowledge.finish(job,new DocumentParser.Result("local-3","READY",List.of(),List.of(new DocumentParser.Fragment("第 1 行",text,"TEXT"))));
        return file.id();
    }
    KnowledgeService.Results search(){return knowledge.search(reader,tenant,space,"语义相关但不含原文字词",0,20);}
    String state(){return db.queryForObject("SELECT state FROM knowledge_remote_index WHERE tenant_id=? ORDER BY created_at LIMIT 1",String.class,tenant);}
    void readyAgain(){db.update("UPDATE knowledge_remote_index SET next_attempt_at=now()-interval '1 second' WHERE tenant_id=?",tenant);}
    void denied(String code,Runnable task){assertEquals(code,assertThrows(IdentityException.class,task::run).code);}
    @Test void indexesAndReturnsLocalCitationWithScopedHybridRerank(){
        parsed("本地原文与引用");worker.tick();assertEquals("READY",state());
        var result=search();assertEquals(1,result.items().size());assertEquals("本地原文与引用",result.items().getFirst().content());
        assertEquals(result.items().getFirst(),knowledge.citation(reader,tenant,result.items().getFirst().id()));
        assertEquals(1,lastSearch.path("knowledge_ids").size());assertTrue(lastSearch.path("rerank").path("enabled").asBoolean());
        assertFalse(lastSearch.path("disable_vector_match").asBoolean());assertFalse(lastSearch.path("disable_keywords_match").asBoolean());
        assertTrue(lastSearch.path("skip_context_enrichment").asBoolean());
        worker.tick();assertEquals(1,creates.get());
    }
    @Test void readOnlySourceRequesterCanIndexButCannotEditSource(){
        UUID material=parsed("只读来源仍可建立检索索引");
        db.update("UPDATE knowledge_runs SET requested_by=? WHERE tenant_id=?",reader,tenant);
        int mask=db.queryForObject("SELECT library_mask(?,?,'MATERIAL',?)",Integer.class,reader,tenant,material);
        assertEquals(1,mask&1);assertEquals(0,mask&2);
        worker.tick();assertEquals("READY",state());assertEquals(1,search().items().size());
        assertEquals(mask,db.queryForObject("SELECT library_mask(?,?,'MATERIAL',?)",Integer.class,reader,tenant,material));
    }
    @Test void revokedSourceRequesterCannotCreateRemoteIndex(){
        parsed("撤权后不得发送原文");
        db.update("UPDATE knowledge_runs SET requested_by=? WHERE tenant_id=?",reader,tenant);
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        worker.tick();assertEquals("FAILED",state());assertEquals(0,creates.get());
    }
    @Test void unindexedIsUnavailableAndEmptyScopeMakesNoRequest(){
        assertEquals(0,search().items().size());assertEquals(0,searches.get());
        parsed("尚未索引");denied("KNOWLEDGE_INDEX_NOT_READY",this::search);assertEquals(0,searches.get());
    }
    @Test void tenantsNotEnrolledKeepLocalSearchButEnrolledFailuresDoNotFallback(){
        parsed("本地关键词");
        db.update("DELETE FROM knowledge_index_targets WHERE tenant_id=?",tenant);
        assertEquals(1,knowledge.search(reader,tenant,space,"本地关键词",0,20).items().size());
        assertEquals(0,searches.get());
        db.update("INSERT INTO knowledge_index_targets(tenant_id,knowledge_base_id,enabled) VALUES (?,?,true)",tenant,kb);
        denied("KNOWLEDGE_INDEX_NOT_READY",()->knowledge.search(reader,tenant,space,"本地关键词",0,20));
        assertEquals(0,searches.get());
    }
    @Test void foreignHitsAndMissingRerankFailClosed(){
        parsed("本地");worker.tick();behavior="foreign";denied("WEKNORA_SCOPE_MISMATCH",this::search);
        behavior="no-rerank";denied("WEKNORA_RERANK_UNAVAILABLE",this::search);
    }
    @Test void revocationDuringSearchPreventsReturningContent(){
        parsed("机密");worker.tick();duringSearch=()->db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        assertThrows(IdentityException.class,this::search);
        searches.set(0);assertEquals(0,knowledge.search(reader,tenant,null,"机密",0,20).items().size());assertEquals(0,searches.get());
    }
    @Test void latestVersionScopeExcludesOldRemoteDocument(){
        UUID material=parsed("旧原文");worker.tick();String old=db.queryForObject("SELECT remote_id FROM knowledge_remote_index WHERE tenant_id=?",String.class,tenant);
        materials.upload(owner,tenant,space,null,material,1,UUID.randomUUID(),new MockMultipartFile("file","synthetic.txt","text/plain","新原文".getBytes(StandardCharsets.UTF_8)));
        var job=knowledge.claim();knowledge.finish(job,new DocumentParser.Result("local-3","READY",List.of(),List.of(new DocumentParser.Fragment("第 1 行","新原文","TEXT"))));
        worker.tick();assertEquals("新原文",search().items().getFirst().content());assertFalse(lastSearch.path("knowledge_ids").toString().contains(old));
    }
    @Test void pendingIndexPollsAndDisabledTargetCleansRemote(){
        parsed("异步索引");behavior="pending";worker.tick();assertEquals("INDEXING",state());
        denied("KNOWLEDGE_INDEX_NOT_READY",this::search);readyAgain();worker.tick();assertEquals("READY",state());
        db.update("UPDATE knowledge_index_targets SET enabled=false WHERE tenant_id=?",tenant);readyAgain();worker.tick();assertEquals("DELETED",state());assertTrue(documents.isEmpty());
    }
    @Test void uncertainCreateIsNeverAutomaticallyReplayed(){
        parsed("只创建一次");behavior="create-unknown";worker.tick();assertEquals("UNKNOWN",state());
        readyAgain();worker.tick();assertEquals(1,creates.get());denied("KNOWLEDGE_INDEX_NOT_READY",this::search);
    }
    @Test void deletingLocalChunksRetainsHandleUntilRemoteCleanup(){
        parsed("删除副本");worker.tick();
        db.update("DELETE FROM knowledge_chunks WHERE tenant_id=?",tenant);
        assertEquals(0,search().items().size());readyAgain();worker.tick();
        assertEquals("DELETED",state());assertTrue(documents.isEmpty());
    }
    @Test void foreignTenantAndRevokedReaderCannotDispatchRemoteSearch(){
        parsed("企业私有原文");worker.tick();UUID other=UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,'外部合成企业')",other);
        assertThrows(IdentityException.class,()->knowledge.search(reader,other,null,"原文",0,20));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        assertEquals(0,knowledge.search(reader,tenant,null,"原文",0,20).items().size());assertEquals(0,searches.get());
    }
    @Test void purgeDoesNotClaimCompleteBeforeRemoteDeletion(){
        UUID material=parsed("待彻底删除");worker.tick();
        lifecycle.act(owner,tenant,space,"MATERIAL",material,UUID.randomUUID(),0,"TRASH");
        db.update("UPDATE content_lifecycle SET purge_after=now()-interval '1 second' WHERE object_id=?",material);
        lifecycle.enqueueDue();var job=cleanup.claim();assertNotNull(job);
        for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);
        assertEquals("QUEUED",db.queryForObject("SELECT state FROM content_cleanup_jobs WHERE id=?",String.class,job.id()));
        readyAgain();worker.tick();assertEquals("DELETED",state());
        job=cleanup.claim();cleanup.finish(job);
        assertEquals("COMPLETE",db.queryForObject("SELECT state FROM content_cleanup_jobs WHERE id=?",String.class,job.id()));
    }
    @AfterEach void cleanup(){duringSearch=()->{};db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    @AfterAll static void stop(){server.stop(0);}
}
