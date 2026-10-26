package com.dreamcore.workspace;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class KnowledgeIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    UUID tenant,other,owner,reader,admin,space,personal;
    @BeforeEach void fixture() {
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成解析测试",passwords.encode("synthetic-knowledge-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'解析测试'),(?,'外部企业')",tenant,other);
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED'),(?,?,?,'个人资料','PERSONAL')",space,tenant,admin,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    record File(UUID material,UUID version) {}
    File upload(UUID location,String filename,String text) {
        var result=materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",filename,"application/octet-stream",text.getBytes(StandardCharsets.UTF_8)));
        return new File(result.id(),materials.detail(owner,tenant,location,result.id(),0,20).versions().getFirst().id());
    }
    KnowledgeService.Job claim(File file) {var job=knowledge.claim();assertNotNull(job);assertEquals(file.version(),job.version());return job;}
    void finish(File file) {var job=claim(file);var input=knowledge.input(job);knowledge.finish(job,parser.parse(input.filename(),input.bytes()));}
    KnowledgeService.Analysis analysis(UUID who,UUID location,File file) {return knowledge.analysis(who,tenant,location,file.material(),file.version(),0,20);}
    void denied(int status,Runnable action) {var error=assertThrows(IdentityException.class,action::run);assertEquals(status,error.status);}
    @AfterEach void clearJobs() {db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
    @Test void supersededAutomaticSceneVersionDoesNotStarveCurrentParse() {
        var file=upload(space,"知识.txt","上一版知识");
        db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES (?,?,?,?)",tenant,space,UUID.randomUUID(),owner);
        db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES (?,'article','KNOWLEDGE',?,'r1','{}')",tenant,file.material());
        materials.upload(owner,tenant,space,null,file.material(),1,UUID.randomUUID(),new MockMultipartFile("file","知识.txt","text/plain","当前知识".getBytes(StandardCharsets.UTF_8)));
        UUID current=materials.detail(owner,tenant,space,file.material(),0,20).versions().getFirst().id();
        var job=knowledge.claim();assertEquals(current,job.version());
        assertEquals("CANCELLED",db.queryForObject("SELECT status FROM knowledge_runs WHERE version_id=?",String.class,file.version()));
        assertEquals("SOURCE_VERSION_SUPERSEDED",db.queryForObject("SELECT warnings FROM knowledge_runs WHERE version_id=?",String.class,file.version()));
        assertEquals(2,db.queryForObject("SELECT count(*) FROM material_versions WHERE material_id=?",Integer.class,file.material()));
    }
    @Test void ordinaryHistoricalUploadStillGetsItsParse() {
        var file=upload(space,"普通资料.txt","上一版资料");
        materials.upload(owner,tenant,space,null,file.material(),1,UUID.randomUUID(),new MockMultipartFile("file","普通资料.txt","text/plain","当前资料".getBytes(StandardCharsets.UTF_8)));
        assertEquals(file.version(),knowledge.claim().version());
    }
    @Test void realTextParseSearchAndImmutableCitation() {
        var file=upload(space,"计划.md","梦核进度\n预算 00123.4500\n<script>alert(1)</script>");finish(file);
        var state=analysis(reader,space,file);assertEquals("READY",state.status());assertEquals(1,state.chunks().size());assertFalse(state.canMaintain());
        var found=knowledge.search(reader,tenant,space,"预算 00123.4500",0,20);assertEquals(1,found.items().size());assertEquals("第 1–3 行",found.items().getFirst().locator());
        assertEquals("梦核进度\n预算 00123.4500\n<script>alert(1)</script>",found.items().getFirst().content());
        assertEquals(found.items().getFirst(),knowledge.citation(reader,tenant,found.items().getFirst().id()));
        assertEquals(0,knowledge.search(reader,tenant,space,"预算 %",0,20).items().size());
        assertEquals(0,knowledge.search(reader,tenant,space,"' OR 1=1 --",0,20).items().size());
    }
    @Test void legacyChineseEncodingWarningSurvivesAdapterValidation() {
        var text="FORMATGB 中文资料";
        var result=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),
            new MockMultipartFile("file","旧编码.txt","text/plain",text.getBytes(java.nio.charset.Charset.forName("GB18030"))));
        var file=new File(result.id(),materials.detail(owner,tenant,space,result.id(),0,20).versions().getFirst().id());
        finish(file);var state=analysis(reader,space,file);
        assertEquals("PARTIAL",state.status());assertEquals("local-3",state.parserVersion());
        assertEquals(List.of("ENCODING_GB18030"),state.warnings());
        assertEquals(text,knowledge.search(reader,tenant,space,"FORMATGB",0,20).items().getFirst().content());
    }
    @Test void privateAndUnassignedContentNeverEnterAggregateOrCitations() {
        var shared=upload(space,"共享.txt","共享标记");finish(shared);var own=upload(personal,"个人.txt","个人标记");finish(own);
        assertEquals(0,knowledge.search(owner,tenant,null,"个人标记",0,20).items().size());
        assertEquals(1,knowledge.search(owner,tenant,personal,"个人标记",0,20).items().size());
        assertEquals(0,knowledge.search(admin,tenant,null,"共享标记",0,20).items().size());
        UUID chunk=analysis(owner,personal,own).chunks().getFirst().id();denied(404,()->knowledge.citation(reader,tenant,chunk));
        denied(404,()->analysis(reader,personal,own));denied(404,()->analysis(admin,space,shared));
        denied(403,()->knowledge.search(owner,other,null,"共享标记",0,20));denied(403,()->knowledge.citation(owner,other,chunk));
        denied(404,()->knowledge.analysis(owner,tenant,space,own.material(),own.version(),0,20));
    }
    @Test void newVersionAndReparseKeepOldCitationButOnlyNewestRunIsSearched() {
        var file=upload(space,"计划.txt","旧标记");finish(file);UUID citation=analysis(owner,space,file).chunks().getFirst().id();
        materials.upload(owner,tenant,space,null,file.material(),1,UUID.randomUUID(),new MockMultipartFile("file","计划.txt","text/plain","新标记".getBytes(StandardCharsets.UTF_8)));
        var second=new File(file.material(),materials.detail(owner,tenant,space,file.material(),0,20).versions().getFirst().id());
        assertEquals(0,knowledge.search(reader,tenant,space,"旧标记",0,20).items().size());finish(second);
        assertEquals(1,knowledge.search(reader,tenant,space,"新标记",0,20).items().size());
        UUID key=UUID.randomUUID();knowledge.request(owner,tenant,space,second.material(),second.version(),key,1);
        assertEquals(0,knowledge.search(reader,tenant,space,"新标记",0,20).items().size());finish(second);
        knowledge.request(owner,tenant,space,second.material(),second.version(),key,1);assertEquals(2,analysis(owner,space,second).generation());
        assertEquals("旧标记",knowledge.citation(reader,tenant,citation).content());
        assertEquals(1,knowledge.search(reader,tenant,space,"新标记",0,20).items().size());
    }
    @Test void parseIsMaintenanceOnlyAndRequestKeysCannotReplayDifferentBodies() {
        var file=upload(space,"资料.txt","hello");finish(file);
        denied(403,()->knowledge.request(reader,tenant,space,file.material(),file.version(),UUID.randomUUID(),1));
        UUID key=UUID.randomUUID();var one=knowledge.request(owner,tenant,space,file.material(),file.version(),key,1);var two=knowledge.request(owner,tenant,space,file.material(),file.version(),key,1);assertEquals(one,two);
        denied(409,()->knowledge.request(owner,tenant,space,file.material(),file.version(),UUID.randomUUID(),1));
        denied(409,()->knowledge.request(owner,tenant,space,file.material(),file.version(),key,2));
        assertEquals(2,db.queryForObject("SELECT count(*) FROM knowledge_runs WHERE version_id=?",Integer.class,file.version()));
    }
    @Test void revocationAfterParsingPreventsPublishingAndBlocksExistingCitation() {
        var file=upload(space,"先完成.txt","授权标记");finish(file);UUID citation=analysis(reader,space,file).chunks().getFirst().id();
        var pending=upload(space,"撤权测试.txt","不应发布");var job=claim(pending);var input=knowledge.input(job);var result=parser.parse(input.filename(),input.bytes());
        db.update("UPDATE workspace_members SET can_maintain=false WHERE workspace_id=? AND account_id=?",space,owner);
        denied(403,()->knowledge.finish(job,result));knowledge.abandon(job,true);
        assertEquals("CANCELLED",analysis(reader,space,pending).status());assertEquals(0,analysis(reader,space,pending).chunks().size());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        denied(404,()->knowledge.citation(reader,tenant,citation));assertEquals(0,knowledge.search(reader,tenant,null,"授权标记",0,20).items().size());
    }
    @Test void suspendedTenantAndAccountStopQueuedAndCompletedReads() {
        var file=upload(space,"资料.txt","hello");var job=claim(file);
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->knowledge.input(job));denied(403,()->analysis(reader,space,file));knowledge.abandon(job,true);
        db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);
        db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",owner);denied(401,()->knowledge.search(owner,tenant,null,"hello",0,20));
    }
    @Test void expiredLeaseCanRecoverAndRejectsLateWorkerResults() {
        var file=upload(space,"恢复.txt","恢复标记");var first=claim(file);var input=knowledge.input(first);var result=parser.parse(input.filename(),input.bytes());
        db.update("UPDATE knowledge_runs SET lease_until=now()-interval '1 second' WHERE id=?",first.id());var second=claim(file);
        assertNotEquals(first.token(),second.token());knowledge.finish(first,result);assertEquals("RUNNING",analysis(owner,space,file).status());
        knowledge.finish(second,result);assertEquals("READY",analysis(owner,space,file).status());knowledge.finish(second,result);assertEquals(1,analysis(owner,space,file).chunks().size());
    }
    @Test void repeatedWorkerCrashesStopAfterThreeAttempts() {
        var file=upload(space,"崩溃.txt","x");KnowledgeService.Job job=null;
        for(int i=0;i<3;i++){job=claim(file);db.update("UPDATE knowledge_runs SET lease_until=now()-interval '1 second' WHERE id=?",job.id());}
        assertNull(knowledge.claim());assertEquals("FAILED",analysis(owner,space,file).status());assertEquals(List.of("WORKER_RETRY_LIMIT"),analysis(owner,space,file).warnings());
    }
    @Test void unsupportedAndCorruptAreHonestAndOriginalsStillDownload() {
        for(String name:List.of("音频.mp3","损坏.pdf")) {var file=upload(space,name,"original");finish(file);assertEquals(name.endsWith("mp3")?"UNSUPPORTED":"FAILED",analysis(reader,space,file).status());assertEquals("original",new String(materials.download(reader,tenant,space,file.material(),file.version()).bytes(),StandardCharsets.UTF_8));}
    }
    @Test void httpUsesAuthenticationCsrfAndNoStoreForContent() throws Exception {
        var file=upload(space,"http.txt","HTTP内容");finish(file);
        var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port;
        String path="/api/v1/tenants/"+tenant+"/knowledge/search?q=HTTP";
        assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",reader+"@example.test","password","synthetic-knowledge-password")))).build();
        assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
        var response=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertTrue(response.body().contains("HTTP内容"));
        var post=HttpRequest.newBuilder(URI.create(base+"/api/v1/tenants/"+tenant+"/workspaces/"+space+"/materials/"+file.material()+"/versions/"+file.version()+"/analysis")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}"));
        assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var fresh=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        post.header(fresh.get("headerName").asString(),fresh.get("token").asString());
        post.POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("requestId",UUID.randomUUID()))));
        assertEquals(400,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        post.POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"expectedGeneration",1))));
        assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
