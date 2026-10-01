package com.dreamcore.workspace;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=100","dreamcore.material.max-bytes=1024"})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class MaterialIntegrationTest {
    static final JsonMapper JSON=new JsonMapper(); static final String PASSWORD="synthetic-material-password-2026";
    @LocalServerPort int port; @Autowired JdbcTemplate db; @Autowired PasswordEncoder passwords; @Autowired Environment env;
    UUID a=UUID.randomUUID(),b=UUID.randomUUID(),owner=UUID.randomUUID(),reader=UUID.randomUUID(),admin=UUID.randomUUID(),foreign=UUID.randomUUID();
    Client writer,viewer,manager,outsider; UUID personal;
    final class Client {
        final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        HttpRequest.Builder request(String path,boolean csrf) throws Exception {
            var req=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path));
            if(csrf) { var token=json(send("GET","/api/v1/auth/csrf",null));req.header(token.get("headerName").asString(),token.get("token").asString()); }
            return req;
        }
        HttpResponse<byte[]> send(String method,String path,Object body) throws Exception {
            var req=request(path,!method.equals("GET")).header("Content-Type","application/json");
            return http.send(req.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofByteArray());
        }
        JsonNode ok(String method,String path,Object body,int status) throws Exception {
            var r=send(method,path,body); assertEquals(status,r.statusCode(),new String(r.body(),StandardCharsets.UTF_8));return r.body().length==0?null:json(r);
        }
        HttpResponse<byte[]> upload(String path,Map<String,Object> metadata,String filename,byte[] bytes,boolean csrf) throws Exception {
            String boundary="dreamcore-"+UUID.randomUUID();
            byte[] head=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n"+JSON.writeValueAsString(metadata)+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+filename+"\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8);
            var req=request(path,csrf).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.concat(
                HttpRequest.BodyPublishers.ofByteArray(head),HttpRequest.BodyPublishers.ofByteArray(bytes),HttpRequest.BodyPublishers.ofString("\r\n--"+boundary+"--\r\n")));
            return http.send(req.build(),HttpResponse.BodyHandlers.ofByteArray());
        }
    }
    JsonNode json(HttpResponse<byte[]> r) { return JSON.readTree(r.body()); }
    Client account(UUID id,String label) throws Exception {
        String email="material-"+id+"@example.test";
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,email,label,passwords.encode(PASSWORD));
        Client c=new Client();c.ok("POST","/api/v1/auth/login",Map.of("email",email,"password",PASSWORD),200);return c;
    }
    @BeforeAll void setup() throws Exception {
        writer=account(owner,"合成维护者");viewer=account(reader,"合成只读成员");manager=account(admin,"合成管理员");outsider=account(foreign,"合成外企成员");
        db.update("INSERT INTO tenants(id,name) VALUES (?,'资料测试 A'),(?,'资料测试 B')",a,b);
        for(UUID id:List.of(owner,reader,admin)) db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",a,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",b,foreign);
        personal=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",personal,a,owner);
    }
    UUID shared() {
        UUID id=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED')",id,a,admin);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",a,id,owner,a,id,reader);return id;
    }
    String base(UUID space) { return "/api/v1/tenants/"+a+"/workspaces/"+space; }
    String control(UUID space,UUID account) { return "/api/tenant-admin/v1/tenants/"+a+"/workspaces/"+space+"/members/"+account; }
    JsonNode put(UUID space,String filename,String content) throws Exception {
        var r=writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),filename,content.getBytes(StandardCharsets.UTF_8),true);
        assertEquals(201,r.statusCode(),new String(r.body(),StandardCharsets.UTF_8));return json(r);
    }
    JsonNode detail(Client c,UUID space,String id) throws Exception { return c.ok("GET",base(space)+"/materials/"+id,null,200); }
    String download(UUID space,JsonNode detail) {
        return base(space)+"/materials/"+detail.get("document").get("id").asString()+"/versions/"+detail.get("versions").get(0).get("id").asString()+"/download";
    }
    @Test void originalsVersionsFoldersAndSharedAggregateUseRealBytes() throws Exception {
        UUID space=shared(),key=UUID.randomUUID();
        var folderBody=Map.of("requestId",key,"name","月报");
        var folder=writer.ok("POST",base(space)+"/folders",folderBody,201);
        assertEquals(folder,writer.ok("POST",base(space)+"/folders",folderBody,201));
        var nested=writer.ok("POST",base(space)+"/folders",Map.of("requestId",UUID.randomUUID(),"parentId",folder.get("id").asString(),"name","九月"),201);
        var first=writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID(),"folderId",nested.get("id").asString()),"统计.csv","金额,数量\n10,2\n".getBytes(StandardCharsets.UTF_8),true);
        assertEquals(201,first.statusCode());String id=json(first).get("id").asString();
        var v1=detail(viewer,space,id);String oldLink=download(space,v1);
        assertFalse(v1.toString().contains("objectId")); assertFalse(v1.toString().contains(".blob"));
        assertEquals("统计.csv",v1.get("document").get("path").get(3).asString());
        assertEquals(201,writer.upload(base(space)+"/materials/"+id+"/versions",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1),"统计修订.csv","金额,数量\n10,3\n".getBytes(StandardCharsets.UTF_8),true).statusCode());
        var current=detail(viewer,space,id); assertEquals(2,current.get("versions").size());assertEquals(2,current.get("document").get("version").asInt());
        var old=viewer.send("GET",oldLink,null);assertEquals(200,old.statusCode());assertEquals("金额,数量\n10,2\n",new String(old.body(),StandardCharsets.UTF_8));
        assertTrue(old.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
        assertEquals("application/octet-stream",old.headers().firstValue("content-type").orElseThrow());
        assertTrue(old.headers().firstValue("content-disposition").orElseThrow().startsWith("attachment;"));
        assertEquals("nosniff",old.headers().firstValue("x-content-type-options").orElseThrow());
        put(personal,"private-only.txt","personal");
        var all=writer.ok("GET","/api/v1/tenants/"+a+"/library",null,200);assertFalse(all.toString().contains("private-only"));
        var search=viewer.ok("GET",base(space)+"/library?q="+URLEncoder.encode("统计",StandardCharsets.UTF_8),null,200);
        assertEquals(1,search.get("items").size()); assertEquals(4,search.get("items").get(0).get("path").size());
    }
    @Test void readAndMaintenanceAreSeparateAndAdminsCannotReadUnassignedContent() throws Exception {
        UUID space=shared();var doc=put(space,"original.txt","synthetic");var info=detail(viewer,space,doc.get("id").asString());
        assertFalse(info.get("document").get("canMaintain").asBoolean());
        assertEquals(403,viewer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),"forbidden.txt",new byte[]{1},true).statusCode());
        assertEquals(403,viewer.send("POST",base(space)+"/folders",Map.of("requestId",UUID.randomUUID(),"name","禁止")).statusCode());
        for(Client c:List.of(manager,outsider)) {
            assertTrue(List.of(403,404).contains(c.send("GET",download(space,info),null).statusCode()));
            assertTrue(List.of(403,404).contains(c.send("GET",base(space)+"/materials/"+doc.get("id").asString(),null).statusCode()));
        }
        assertEquals(404,viewer.send("GET",base(personal)+"/library",null).statusCode());
        UUID key=UUID.randomUUID();var permission=Map.of("requestId",key,"expectedVersion",0,"enabled",true);
        manager.ok("POST",control(space,reader)+"/maintenance",permission,200);
        manager.ok("POST",control(space,reader)+"/maintenance",permission,200);
        assertTrue(detail(viewer,space,doc.get("id").asString()).get("document").get("canMaintain").asBoolean());
        assertEquals(201,viewer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),"allowed.txt",new byte[]{2},true).statusCode());
        assertEquals(409,manager.send("POST",control(space,reader)+"/maintenance",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",false)).statusCode());
        manager.ok("POST",control(space,reader)+"/maintenance",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"enabled",false),200);
        manager.ok("POST",control(space,reader)+"/maintenance",permission,200); // old retry must not re-enable
        assertFalse(detail(viewer,space,doc.get("id").asString()).get("document").get("canMaintain").asBoolean());
        assertEquals(403,manager.send("POST",control(space,admin)+"/maintenance",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"enabled",true)).statusCode());
        assertEquals(200,viewer.send("GET",download(space,info),null).statusCode());
        manager.ok("POST",control(space,reader),Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"enabled",false),200);
        assertEquals(404,viewer.send("GET",download(space,info),null).statusCode());
        manager.ok("POST",control(space,reader),Map.of("requestId",UUID.randomUUID(),"expectedVersion",3,"enabled",true),200);
        assertFalse(detail(viewer,space,doc.get("id").asString()).get("document").get("canMaintain").asBoolean());
    }
    @Test void platformRolesAndForgedResourceIdsNeverBypassContentAuthorization() throws Exception {
        UUID space=shared(),other=shared();var doc=put(space,"secret.txt","synthetic-content");var info=detail(writer,space,doc.get("id").asString());
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",foreign);
        try {
            assertEquals(403,outsider.send("GET",download(space,info),null).statusCode());
            assertEquals(404,writer.send("GET",download(space,info).replace(space.toString(),other.toString()),null).statusCode());
            assertEquals(404,writer.send("GET",download(space,info).replace(doc.get("id").asString(),UUID.randomUUID().toString()),null).statusCode());
            assertEquals(403,writer.send("GET",download(space,info).replace(a.toString(),b.toString()),null).statusCode());
            assertEquals(401,new Client().send("GET",download(space,info),null).statusCode());
        } finally { db.update("DELETE FROM platform_roles WHERE account_id=?",foreign); }
    }
    @Test void sameUploadKeyAndConcurrentUpdatesCannotDuplicateOrOverwriteVersions() throws Exception {
        UUID space=shared(),key=UUID.randomUUID();var body=Map.<String,Object>of("requestId",key);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var one=pool.submit(()->writer.upload(base(space)+"/materials",body,"same.txt",new byte[]{1},true));
            var two=pool.submit(()->writer.upload(base(space)+"/materials",body,"same.txt",new byte[]{1},true));
            var r1=one.get();var r2=two.get();assertEquals(201,r1.statusCode());assertEquals(201,r2.statusCode());assertEquals(json(r1),json(r2));
            String id=json(r1).get("id").asString();
            assertEquals(409,writer.upload(base(space)+"/materials",body,"same.txt",new byte[]{2},true).statusCode());
            var change1=Map.<String,Object>of("requestId",UUID.randomUUID(),"expectedVersion",1);
            var change2=Map.<String,Object>of("requestId",UUID.randomUUID(),"expectedVersion",1);
            String endpoint=base(space)+"/materials/"+id+"/versions";
            var f1=pool.submit(()->writer.upload(endpoint,change1,"v2.txt",new byte[]{2},true));
            var f2=pool.submit(()->writer.upload(endpoint,change2,"v2.txt",new byte[]{3},true));
            var first=f1.get();var second=f2.get();assertEquals(List.of(201,409),java.util.stream.Stream.of(first.statusCode(),second.statusCode()).sorted().toList());
            assertEquals(2,detail(writer,space,id).get("versions").size());
            writer.upload(endpoint,Map.of("requestId",UUID.randomUUID(),"expectedVersion",2),"v3.txt",new byte[]{4},true);
            var retry=writer.upload(endpoint,first.statusCode()==201?change1:change2,"v2.txt",new byte[]{(byte)(first.statusCode()==201?2:3)},true);
            assertEquals(201,retry.statusCode());assertEquals(2,json(retry).get("version").asInt());assertEquals(3,json(retry).get("currentVersion").asInt());assertEquals("EXACT",json(retry).get("receiptStatus").asString());assertEquals(2,json(retry).get("acceptedVersion").get("number").asInt());assertEquals(3,detail(writer,space,id).get("versions").size());
        }
    }
    @Test void rejectsOversizeInvalidNamesWrongFolderAndMissingCsrf() throws Exception {
        UUID space=shared(),other=shared();
        var body=Map.<String,Object>of("requestId",UUID.randomUUID());
        assertEquals(413,writer.upload(base(space)+"/materials",body,"big.txt",new byte[1025],true).statusCode());
        assertEquals(403,writer.upload(base(space)+"/materials",body,"file.txt",new byte[]{1},false).statusCode());
        assertEquals(400,writer.upload(base(space)+"/materials",body,"../escape.txt",new byte[]{1},true).statusCode());
        var folder=writer.ok("POST",base(other)+"/folders",Map.of("requestId",UUID.randomUUID(),"name","Other"),201);
        assertEquals(404,writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID(),"folderId",folder.get("id").asString()),"x.txt",new byte[]{1},true).statusCode());
        assertEquals(400,writer.send("POST",base(space)+"/folders",Map.of("requestId",UUID.randomUUID(),"name","bad\n\nname")).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM materials WHERE workspace_id=?",Integer.class,space));
    }
    @Test void storageTamperingAndUnavailableDestinationNeverReturnSuccess() throws Exception {
        UUID space=shared();var doc=put(space,"verify.txt","known");String id=doc.get("id").asString();var info=detail(writer,space,id);
        UUID object=db.queryForObject("SELECT object_id FROM material_versions WHERE material_id=?",UUID.class,UUID.fromString(id));
        Path file=Path.of(env.getRequiredProperty("dreamcore.material.storage-root"),object+".blob");
        assertEquals("rw-------",java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(file)));
        Files.writeString(file,"alter");assertEquals(503,writer.send("GET",download(space,info),null).statusCode());
        Files.delete(file);assertEquals(503,writer.send("GET",download(space,info),null).statusCode());
        Path root=file.getParent(),away=root.resolveSibling("objects-away-"+UUID.randomUUID());Files.move(root,away);Files.writeString(root,"occupied");
        try {
            var response=writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),"failed.txt",new byte[]{1},true);
            assertEquals(503,response.statusCode());assertFalse(new String(response.body(),StandardCharsets.UTF_8).contains(root.toString()));
            assertEquals(1,db.queryForObject("SELECT count(*) FROM materials WHERE workspace_id=?",Integer.class,space));
        } finally { Files.delete(root);Files.move(away,root); }
    }
    @Test void rollbackDiscardsOriginalAndDoesNotPublishPartialVersion() throws Exception {
        UUID space=shared();put(space,"before.txt","original");Path root=Path.of(env.getRequiredProperty("dreamcore.material.storage-root"));
        long before;try(var files=Files.list(root)){before=files.count();}
        db.execute("CREATE FUNCTION material_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.filename='force-rollback.txt' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$");
        db.execute("CREATE TRIGGER material_test_failure BEFORE INSERT ON material_versions FOR EACH ROW EXECUTE FUNCTION material_test_failure()");
        try {
            var response=writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),"force-rollback.txt",new byte[]{1},true);
            assertEquals(500,response.statusCode());assertEquals(1,db.queryForObject("SELECT count(*) FROM materials WHERE workspace_id=?",Integer.class,space));
            try(var files=Files.list(root)){assertEquals(before,files.count());}
        } finally { db.execute("DROP TRIGGER material_test_failure ON material_versions");db.execute("DROP FUNCTION material_test_failure()"); }
    }
    @Test void requestWaitingOnPermissionChangeRechecksAfterCommit() throws Exception {
        UUID space=shared();var doc=put(space,"revocation.txt","old");String path=download(space,detail(writer,space,doc.get("id").asString()));
        try(var connection=db.getDataSource().getConnection();var pool=Executors.newFixedThreadPool(2)) {
            connection.setAutoCommit(false);
            try(var lock=connection.prepareStatement("SELECT id FROM tenants WHERE id=? FOR UPDATE")){lock.setObject(1,a);lock.executeQuery().close();}
            try(var change=connection.prepareStatement("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=?")){change.setObject(1,a);change.setObject(2,space);change.executeUpdate();}
            var read=pool.submit(()->viewer.send("GET",path,null));
            var upload=pool.submit(()->writer.upload(base(space)+"/materials",Map.of("requestId",UUID.randomUUID()),"late.txt",new byte[]{2},true));
            Thread.sleep(150);assertFalse(read.isDone());assertFalse(upload.isDone());connection.commit();
            assertEquals(404,read.get(10,TimeUnit.SECONDS).statusCode());assertEquals(404,upload.get(10,TimeUnit.SECONDS).statusCode());
            assertEquals(1,db.queryForObject("SELECT count(*) FROM materials WHERE workspace_id=?",Integer.class,space));
        }
    }
}
