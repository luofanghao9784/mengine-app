package com.dreamcore.workspace;

import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Current M2 capabilities only: no claims about future retrieval or running engine tasks. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=100","dreamcore.material.max-bytes=1024"})
class RevocationIntegrationTest {
    enum Change { MAINTENANCE, GRANT, MEMBER, TENANT, ACCOUNT, LOGOUT, SESSION }
    static final JsonMapper JSON=new JsonMapper();
    static final String PASSWORD="synthetic-revocation-password-2026";
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    UUID a,b,actor,admin,platform,shared,personalA,personalB,folder;
    Client member,peer,manager,operator;
    String document,privateA,privateB;
    List<String> downloads;
    Map<String,Object> folderRequest,uploadRequest,versionRequest;
    byte[] original="synthetic-private-original-v1".getBytes(StandardCharsets.UTF_8);
    byte[] revised="synthetic-private-original-v2".getBytes(StandardCharsets.UTF_8);
    final class Client {
        final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        HttpRequest.Builder request(String path) { return HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(java.time.Duration.ofSeconds(15)); }
        HttpRequest.Builder csrf(String path) throws Exception {
            var req=request(path); var response=get(path.startsWith("/api/platform-admin/")?"/api/platform-admin/v1/auth/csrf":"/api/v1/auth/csrf");
            if(response.statusCode()==200) { var token=json(response);req.header(token.get("headerName").asString(),token.get("token").asString()); }
            return req;
        }
        HttpResponse<byte[]> get(String path) throws Exception { return http.send(request(path).GET().build(),HttpResponse.BodyHandlers.ofByteArray()); }
        HttpResponse<byte[]> post(String path,Object body) throws Exception {
            return http.send(csrf(path).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofByteArray());
        }
        JsonNode ok(String path,Object body,int status) throws Exception {
            var r=body==null?get(path):post(path,body); assertEquals(status,r.statusCode(),path);return r.body().length==0?null:json(r);
        }
        HttpResponse<byte[]> upload(String path,Map<String,Object> metadata,byte[] bytes) throws Exception {
            String boundary="dreamcore-"+UUID.randomUUID();
            byte[] head=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n"+JSON.writeValueAsString(metadata)+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"private-name.txt\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8);
            return http.send(csrf(path).header("Content-Type","multipart/form-data; boundary="+boundary).POST(HttpRequest.BodyPublishers.concat(
                HttpRequest.BodyPublishers.ofByteArray(head),HttpRequest.BodyPublishers.ofByteArray(bytes),HttpRequest.BodyPublishers.ofString("\r\n--"+boundary+"--\r\n"))).build(),HttpResponse.BodyHandlers.ofByteArray());
        }
        void login(UUID id) throws Exception { ok("/api/v1/auth/login",Map.of("email",id+"@revoke.example.test","password",PASSWORD),200); }
    }
    JsonNode json(HttpResponse<byte[]> response) { return JSON.readTree(response.body()); }
    Client account(UUID id) throws Exception {
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@revoke.example.test","合成撤权成员",passwords.encode(PASSWORD));
        Client c=new Client();c.login(id);return c;
    }
    UUID space(UUID tenant,boolean sharedSpace) {
        UUID id=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,?)",id,tenant,sharedSpace?admin:actor,sharedSpace?"合成共享空间":"个人空间",sharedSpace?"SHARED":"PERSONAL");return id;
    }
    String root(UUID tenant,UUID space) { return "/api/v1/tenants/"+tenant+"/workspaces/"+space; }
    String base() { return root(a,shared); }
    String management() { return "/api/tenant-admin/v1/tenants/"+a; }
    String control() { return management()+"/workspaces/"+shared+"/members/"+actor; }
    String privateFile(UUID tenant,UUID space) throws Exception {
        var result=member.upload(root(tenant,space)+"/materials",Map.of("requestId",UUID.randomUUID()),original);
        assertEquals(201,result.statusCode()); String id=json(result).get("id").asString();
        var detail=member.ok(root(tenant,space)+"/materials/"+id,null,200);
        return root(tenant,space)+"/materials/"+id+"/versions/"+detail.get("versions").get(0).get("id").asString()+"/download";
    }
    @BeforeEach void setup() throws Exception {
        a=UUID.randomUUID();b=UUID.randomUUID();actor=UUID.randomUUID();admin=UUID.randomUUID();platform=UUID.randomUUID();
        member=account(actor);peer=new Client();peer.login(actor);manager=account(admin);operator=account(platform);
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platform);
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",platform,platform+"@revoke.example.test",passwords.encode(PASSWORD));
        operator.ok("/api/platform-admin/v1/auth/login",Map.of("username",platform+"@revoke.example.test","password",PASSWORD),200);
        db.update("INSERT INTO tenants(id,name) VALUES (?,'撤权 A'),(?,'撤权 B')",a,b);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER'),(?,?,'MEMBER'),(?,?,'TENANT_ADMIN')",a,actor,b,actor,a,admin);
        shared=space(a,true);personalA=space(a,false);personalB=space(b,false);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",a,shared,actor);
        folderRequest=Map.of("requestId",UUID.randomUUID(),"name","private-folder");
        folder=UUID.fromString(member.ok(base()+"/folders",folderRequest,201).get("id").asString());
        uploadRequest=Map.of("requestId",UUID.randomUUID(),"folderId",folder);
        var uploaded=member.upload(base()+"/materials",uploadRequest,original);assertEquals(201,uploaded.statusCode());document=json(uploaded).get("id").asString();
        versionRequest=Map.of("requestId",UUID.randomUUID(),"expectedVersion",1);
        assertEquals(201,member.upload(base()+"/materials/"+document+"/versions",versionRequest,revised).statusCode());
        downloads=new ArrayList<>();
        for(var version:member.ok(base()+"/materials/"+document,null,200).get("versions")) downloads.add(base()+"/materials/"+document+"/versions/"+version.get("id").asString()+"/download");
        privateA=privateFile(a,personalA);privateB=privateFile(b,personalB);
    }
    @AfterEach void removeFixturePlatformRole() {
        // The bootstrap integration test deliberately starts without a platform role.
        if(platform!=null) {
            db.update("DELETE FROM platform_sessions WHERE account_id=?",platform);
            db.update("DELETE FROM tenant_service_changes WHERE actor_id=?",platform);
            db.update("DELETE FROM platform_accounts WHERE account_id=?",platform);
            db.update("DELETE FROM platform_roles WHERE account_id=?",platform);
        }
    }
    long version() throws Exception { return manager.ok(management()+"/workspaces/"+shared,null,200).get("version").asLong(); }
    void grant(boolean enabled) throws Exception { manager.ok(control(),Map.of("requestId",UUID.randomUUID(),"expectedVersion",version(),"enabled",enabled),200); }
    void maintain(boolean enabled) throws Exception { manager.ok(control()+"/maintenance",Map.of("requestId",UUID.randomUUID(),"expectedVersion",version(),"enabled",enabled),200); }
    void statusMember(String status) throws Exception {
        long version=db.queryForObject("SELECT management_version FROM tenant_memberships WHERE tenant_id=? AND account_id=?",Long.class,a,actor);
        manager.ok(management()+"/members/"+actor+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",version,"status",status),200);
    }
    void statusTenant(String status) throws Exception {
        String path="/api/platform-admin/v1/tenants/"+a;
        long version=operator.ok(path,null,200).get("version").asLong();
        operator.ok(path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",version,"status",status,"internalReason","合成撤权检查","publicReason","合成服务状态"),200);
    }
    void revoke(Change change) throws Exception {
        switch(change) {
            case MAINTENANCE -> maintain(false);
            case GRANT -> grant(false);
            case MEMBER -> statusMember("DISABLED");
            case TENANT -> statusTenant("SUSPENDED");
            // No product account-disable endpoint exists yet; exercise the enforced account state with a fixture mutation.
            case ACCOUNT -> db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",actor);
            case LOGOUT -> member.ok("/api/v1/auth/logout",Map.of(),204);
            case SESSION -> db.update("UPDATE spring_session SET last_access_time=0,expiry_time=0 WHERE principal_name=?",actor.toString());
        }
    }
    int denied(Change change) { return change==Change.GRANT?404:change==Change.MEMBER||change==Change.TENANT?403:401; }
    void rejected(HttpResponse<byte[]> response,int expected) {
        assertEquals(expected,response.statusCode());
        String text=new String(response.body(),StandardCharsets.UTF_8);
        assertFalse(text.contains("private-name"));assertFalse(text.contains("private-folder"));assertFalse(text.contains("synthetic-private-original"));assertFalse(text.contains(document));
        assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
        assertTrue(response.headers().firstValue("content-disposition").isEmpty());
        assertEquals("1.0",json(response).get("contractVersion").asString());
    }
    List<Integer> facts() {
        return List.of(db.queryForObject("SELECT count(*) FROM materials WHERE tenant_id=?",Integer.class,a),
            db.queryForObject("SELECT count(*) FROM material_versions WHERE tenant_id=?",Integer.class,a),
            db.queryForObject("SELECT count(*) FROM material_folders WHERE tenant_id=?",Integer.class,a),
            db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action LIKE 'MATERIAL_%' AND action<>'MATERIAL_DOWNLOAD' AND outcome='SUCCESS'",Integer.class,a));
    }
    void deniedWrites(int status) throws Exception {
        var before=facts();
        rejected(member.post(base()+"/folders",folderRequest),status);
        rejected(member.post(base()+"/folders",Map.of("requestId",UUID.randomUUID(),"name","forbidden")),status);
        rejected(member.upload(base()+"/materials",uploadRequest,original),status);
        rejected(member.upload(base()+"/materials",Map.of("requestId",UUID.randomUUID()),original),status);
        rejected(member.upload(base()+"/materials/"+document+"/versions",versionRequest,revised),status);
        rejected(member.upload(base()+"/materials/"+document+"/versions",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2),original),status);
        assertEquals(before,facts(),"Denied requests must not create rows, versions or success records");
    }
    @ParameterizedTest @EnumSource(Change.class)
    void oldSessionsAndRequestKeysFollowCurrentPermissions(Change change) throws Exception {
        revoke(change);
        if(change==Change.MAINTENANCE) {
            member.ok(base()+"/library?folder="+folder,null,200);member.ok(base()+"/materials/"+document,null,200);
            assertArrayEquals(revised,member.get(downloads.get(0)).body());assertArrayEquals(original,member.get(downloads.get(1)).body());
            deniedWrites(403);
        } else {
            int status=denied(change);
            for(String path:List.of(base()+"/library",base()+"/library?folder="+folder,base()+"/library?q=private",base()+"/materials/"+document,base()+"/materials/"+document+"?offset=1&limit=1",downloads.get(0),downloads.get(1))) rejected(member.get(path),status);
            deniedWrites(status);
        }
        boolean global=EnumSet.of(Change.ACCOUNT,Change.LOGOUT,Change.SESSION).contains(change);
        if(global) rejected(member.get(privateB),401);else assertEquals(200,member.get(privateB).statusCode());
        if(change==Change.GRANT || change==Change.MAINTENANCE) assertEquals(200,member.get(privateA).statusCode());
        else rejected(member.get(privateA),denied(change));
        if(change==Change.GRANT) {
            var aggregate=member.ok("/api/v1/tenants/"+a+"/library?q=private",null,200);
            assertEquals(0,aggregate.get("items").size());
            assertFalse(member.ok("/api/v1/tenants/"+a+"/context",null,200).toString().contains(shared.toString()));
        } else if(change!=Change.MAINTENANCE) {
            rejected(member.get("/api/v1/tenants/"+a+"/library"),denied(change));
            rejected(member.get("/api/v1/tenants/"+a+"/context"),denied(change));
        }
        // Independent sessions are revoked by account/member/tenant changes, but logout remains session-local.
        assertEquals(change==Change.LOGOUT||change==Change.MAINTENANCE?200:denied(change),peer.get(downloads.get(0)).statusCode());
        switch(change) {
            case MAINTENANCE -> maintain(true);
            case GRANT -> { grant(true);deniedWrites(403);assertEquals(200,member.get(downloads.get(0)).statusCode());maintain(true); }
            case MEMBER -> statusMember("ACTIVE");
            case TENANT -> statusTenant("ACTIVE");
            case ACCOUNT -> { db.update("UPDATE accounts SET status='ACTIVE' WHERE id=?",actor);rejected(member.get(privateA),401);member.login(actor); }
            case LOGOUT, SESSION -> member.login(actor);
        }
        assertArrayEquals(original,member.get(downloads.get(1)).body());
        var before=facts();var retry=member.upload(base()+"/materials",uploadRequest,original);
        assertEquals(201,retry.statusCode());assertEquals(document,json(retry).get("id").asString());assertEquals("EXACT",json(retry).get("receiptStatus").asString());assertEquals(1,json(retry).get("version").asInt());assertEquals(1,json(retry).get("acceptedVersion").get("number").asInt());assertEquals(2,json(retry).get("currentVersion").asInt());assertEquals(before,facts());
        assertEquals(201,member.upload(base()+"/materials/"+document+"/versions",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2),original).statusCode());
    }
    @Test void restoreDoesNotRestoreRemovedGrantOrIndependentlyDisabledMember() throws Exception {
        grant(false);statusMember("DISABLED");statusTenant("SUSPENDED");statusTenant("ACTIVE");
        rejected(member.get(downloads.get(0)),403);assertEquals(200,member.get(privateB).statusCode());
        statusMember("ACTIVE");rejected(member.get(downloads.get(0)),404);assertEquals(200,member.get(privateA).statusCode());
        grant(true);deniedWrites(403);assertArrayEquals(original,member.get(downloads.get(1)).body());
    }
    @ParameterizedTest @EnumSource(value=Change.class,names={"MAINTENANCE","GRANT","MEMBER","TENANT","ACCOUNT"})
    void requestsBlockedOnTenantLockRecheckTheCommittedState(Change change) throws Exception {
        try(var connection=db.getDataSource().getConnection();var pool=Executors.newFixedThreadPool(2)) {
            connection.setAutoCommit(false);
            try {
                sql(connection,"SELECT id FROM tenants WHERE id=? FOR UPDATE",a);
                var read=pool.submit(()->peer.get(downloads.get(0)));
                var write=pool.submit(()->member.upload(base()+"/materials",Map.of("requestId",UUID.randomUUID()),original));
                long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);boolean waiting=false;
                while(System.nanoTime()<until) {
                    if(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%'",Integer.class)>=2) { waiting=true;break; }
                    Thread.sleep(20);
                }
                assertTrue(waiting,"Both real requests must be waiting before committing the revocation");
                switch(change) {
                    case MAINTENANCE -> sql(connection,"UPDATE workspace_members SET can_maintain=false WHERE tenant_id=? AND workspace_id=?",a,shared);
                    case GRANT -> sql(connection,"DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=?",a,shared);
                    case MEMBER -> sql(connection,"UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",a,actor);
                    case TENANT -> sql(connection,"UPDATE tenants SET status='SUSPENDED' WHERE id=?",a);
                    case ACCOUNT -> sql(connection,"UPDATE accounts SET status='DISABLED' WHERE id=?",actor);
                    default -> throw new AssertionError();
                }
                var before=facts();connection.commit();
                if(change==Change.MAINTENANCE) assertEquals(200,read.get(10,TimeUnit.SECONDS).statusCode());else rejected(read.get(10,TimeUnit.SECONDS),denied(change));
                rejected(write.get(10,TimeUnit.SECONDS),change==Change.MAINTENANCE?403:denied(change));assertEquals(before,facts());
            } finally { connection.rollback(); }
        }
    }
    void sql(Connection connection,String sql,UUID... args) throws Exception {
        try(var query=connection.prepareStatement(sql)) { for(int i=0;i<args.length;i++)query.setObject(i+1,args[i]);query.execute(); }
    }
    enum PlatformAction { CREATE, STATUS, INVITATION }
    @ParameterizedTest @EnumSource(PlatformAction.class)
    void queuedPlatformMutationsRecheckRemovedRole(PlatformAction action) throws Exception {
        UUID key=UUID.randomUUID();String path;Map<String,Object> body;
        String pending=operator.ok("/api/platform-admin/v1/tenants",Map.of("requestId",UUID.randomUUID(),"name","Pending fixture","adminEmail",UUID.randomUUID()+"@revoke.example.test"),201).get("tenant").get("id").asString();
        if(action==PlatformAction.CREATE) {
            path="/api/platform-admin/v1/tenants";body=Map.of("requestId",key,"name","Forbidden tenant","adminEmail",UUID.randomUUID()+"@revoke.example.test");
        } else if(action==PlatformAction.STATUS) {
            path="/api/platform-admin/v1/tenants/"+a+"/status";body=Map.of("requestId",key,"expectedVersion",0,"status","SUSPENDED","internalReason","合成撤权检查","publicReason","合成服务状态");
        } else {
            path="/api/platform-admin/v1/tenants/"+pending+"/initial-admin-invitation";
            body=Map.of("requestId",key,"expectedVersion",0,"email",UUID.randomUUID()+"@revoke.example.test");
        }
        try(var connection=db.getDataSource().getConnection();var pool=Executors.newSingleThreadExecutor()) {
            connection.setAutoCommit(false);
            try {
                try(var lock=connection.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?,0))")) {
                    lock.setString(1,"request:"+platform+":"+key);lock.execute();
                }
                var future=pool.submit(()->operator.post(path,body));
                long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);boolean waiting=false;
                while(System.nanoTime()<until) {
                    if(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'",Integer.class)>0) { waiting=true;break; }
                    Thread.sleep(20);
                }
                assertTrue(waiting,"The platform action must wait before its role is removed");
                sql(connection,"DELETE FROM platform_roles WHERE account_id=?",platform);connection.commit();
                rejected(future.get(10,TimeUnit.SECONDS),403);
                assertEquals(0,db.queryForObject("SELECT count(*) FROM identity_requests WHERE actor_id=? AND request_id=?",Integer.class,platform,key));
                assertEquals("ACTIVE",db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,a));
                assertEquals(0,db.queryForObject("SELECT management_version FROM tenants WHERE id=?",Integer.class,UUID.fromString(pending)));
            } finally { connection.rollback(); }
        }
    }
    @Test void operationalRecordsNeverExposePrivateMaterialActivity() throws Exception {
        member.get(downloads.get(0));grant(false);
        for(String response:List.of(operator.ok("/api/platform-admin/v1/tenants/"+a+"/records",null,200).toString(),manager.ok(management()+"/records",null,200).toString())) {
            assertFalse(response.contains(document));assertFalse(response.contains(folder.toString()));assertFalse(response.contains("MATERIAL_"));assertFalse(response.contains("private-name"));assertFalse(response.contains("synthetic-private-original"));
        }
        rejected(operator.get(downloads.get(0)),401);rejected(manager.get(downloads.get(0)),404);
    }
}
