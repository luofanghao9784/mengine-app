package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
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
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class MaterialProcessingIntegrationTest {
    @Autowired JdbcTemplate db; @Autowired MaterialService materials; @Autowired MaterialProcessingService processing;
    @Autowired KnowledgeService knowledge; @Autowired PasswordEncoder passwords; @LocalServerPort int port;
    UUID tenant,owner,reader,admin,space,personal,other;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();other=UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,'合成资料管理'),(?,'无权企业')",tenant,other);
        for(UUID id:List.of(owner,reader,admin)){
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成资料管理",passwords.encode("synthetic-processing-password"));
            db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        }
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享空间','SHARED'),(?,?,?,'个人空间','PERSONAL')",space,tenant,owner,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    record File(UUID material,UUID version){}
    File upload(UUID location,String name){var m=materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain","synthetic only".getBytes()));return new File(m.id(),materials.detail(owner,tenant,location,m.id(),0,20).versions().getFirst().id());}
    void status(File f,String state){db.update("UPDATE knowledge_runs SET status=?,finished_at=CASE WHEN ? IN ('READY','PARTIAL','FAILED','UNSUPPORTED','CANCELLED') THEN now() ELSE NULL END WHERE version_id=?",state,state,f.version());}
    MaterialProcessingService.Page list(UUID actor){return processing.list(actor,tenant,null,"","ALL",0,20);}
    void denied(int code,Runnable fn){assertEquals(code,assertThrows(IdentityException.class,fn::run).status);}
    @AfterEach void cancel(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
    @Test void sharedScopeNeverIncludesPrivateAttachmentsOrAdminUnassignedFiles(){
        upload(space,"共享文件.txt");upload(personal,"私人文件.txt");var attachment=upload(space,"未加入资料库.txt");db.update("UPDATE materials SET in_library=false WHERE id=?",attachment.material());
        var data=list(reader);assertEquals(1,data.summary().total());assertEquals(1,data.items().size());assertEquals("共享文件.txt",data.items().getFirst().name());assertFalse(data.items().getFirst().canMaintain());assertTrue(list(owner).items().getFirst().canMaintain());assertEquals(0,list(admin).summary().total());
        denied(404,()->processing.list(admin,tenant,space,"","ALL",0,20));denied(404,()->processing.list(owner,tenant,personal,"","ALL",0,20));denied(403,()->processing.list(owner,other,null,"","ALL",0,20));
    }
    @Test void statusSummaryUsesLatestVersionAndLatestGenerationOnly(){
        for(String state:List.of("READY","PARTIAL","QUEUED","RUNNING","FAILED","UNSUPPORTED","CANCELLED")){var f=upload(space,state+".txt");status(f,state);}
        var none=upload(space,"未开始.txt");db.update("DELETE FROM knowledge_runs WHERE version_id=?",none.version());
        var data=list(reader);assertEquals(new MaterialProcessingService.Summary(8,1,2,4,1),data.summary());assertTrue(data.parserAvailable());
        var ready=data.items().stream().filter(i->i.status().equals("READY")).findFirst().orElseThrow();
        knowledge.request(owner,tenant,space,ready.materialId(),ready.versionId(),UUID.randomUUID(),1);
        assertEquals(new MaterialProcessingService.Summary(8,0,3,4,1),list(reader).summary());
        materials.upload(owner,tenant,space,null,ready.materialId(),1,UUID.randomUUID(),new MockMultipartFile("file","新版.txt","text/plain","new".getBytes()));
        var latest=list(reader).items().stream().filter(i->i.materialId().equals(ready.materialId())).findFirst().orElseThrow();assertEquals(2,latest.version());assertEquals(1,latest.generation());assertNotEquals(ready.versionId(),latest.versionId());assertEquals(8,list(reader).summary().total());
    }
    @Test void searchAndPagingAreLiteralAndSummaryRemainsScopeTotal(){
        var a=upload(space,"预算%.txt");status(a,"FAILED");var b=upload(space,"预算其他.txt");status(b,"READY");upload(space,"无关.txt");
        var data=processing.list(reader,tenant,space,"%","ATTENTION",0,1);assertEquals(3,data.summary().total());assertEquals(1,data.items().size());assertEquals(a.material(),data.items().getFirst().materialId());assertFalse(data.hasMore());
        var first=processing.list(reader,tenant,space,"预算","ALL",0,1);var next=processing.list(reader,tenant,space,"预算","ALL",1,1);assertTrue(first.hasMore());assertFalse(next.hasMore());assertNotEquals(first.items().getFirst().materialId(),next.items().getFirst().materialId());assertEquals(3,next.summary().total());
        assertTrue(processing.list(reader,tenant,space,"' OR 1=1","ALL",0,20).items().isEmpty());
        denied(400,()->processing.list(reader,tenant,null,"","UNKNOWN",0,20));denied(400,()->processing.list(reader,tenant,null,"","ALL",-1,20));
    }
    @Test void recycleAndParentRecycleDisappearFromSummaryAndRestoreSameVersion(){
        var f=upload(space,"回收.txt");status(f,"READY");db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,f.material());assertEquals(0,list(reader).summary().total());
        db.update("UPDATE content_lifecycle SET state='ACTIVE' WHERE object_id=?",f.material());assertEquals(f.version(),list(reader).items().getFirst().versionId());
        var folder=materials.createFolder(owner,tenant,space,null,"目录",UUID.randomUUID());db.update("UPDATE materials SET folder_id=? WHERE id=?",folder.id(),f.material());db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'FOLDER',?,'TRASHED')",tenant,space,folder.id());assertEquals(0,list(reader).summary().total());
    }
    @Test void revocationClearsAggregateAndRejectsExactSpaceAndParserRetry(){
        var f=upload(space,"受限.txt");status(f,"FAILED");assertEquals(1,list(reader).summary().total());
        denied(403,()->knowledge.request(reader,tenant,space,f.material(),f.version(),UUID.randomUUID(),1));
        db.update("DELETE FROM workspace_members WHERE account_id=?",reader);assertEquals(0,list(reader).summary().total());denied(404,()->processing.list(reader,tenant,space,"","ALL",0,20));
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);denied(403,()->list(owner));
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->list(admin));
    }
    @Test void httpRequiresCustomerSessionAndNoStoreWithoutRawContent() throws Exception {
        var f=upload(space,"公开到获权空间的文件.txt");status(f,"FAILED");var json=new JsonMapper();String base="http://127.0.0.1:"+port,path="/api/v1/tenants/"+tenant+"/knowledge/processing";
        var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",reader+"@example.test","password","synthetic-processing-password")))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
        var response=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));var body=json.readTree(response.body());assertEquals(1,body.get("summary").get("attention").asInt());assertFalse(response.body().contains("synthetic only"));assertFalse(response.body().contains("object_id"));
        db.update("DELETE FROM workspace_members WHERE account_id=?",reader);assertEquals(0,json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).body()).get("items").size());
    }
}
