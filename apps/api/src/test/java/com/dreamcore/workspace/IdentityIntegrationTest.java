package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"dreamcore.auth.ip-attempts=1000", "dreamcore.auth.email-attempts=20"})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class IdentityIntegrationTest {
    private static final String PASSWORD = "synthetic-only-password-2026";
    private static final JsonMapper JSON = new JsonMapper();
    @LocalServerPort int port;
    @Autowired IdentityService identities;
    @Autowired JdbcTemplate db;
    @Autowired Environment env;
    Client platform, adminA, adminB, employee;
    String tenantA, tenantB, employeeId;
    UUID platformId;

    final class Client {
        final boolean platformRealm;
        Client() { this(false); }
        Client(boolean platformRealm) { this.platformRealm=platformRealm; }
        final CookieManager cookies = new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();
        HttpResponse<String> send(String method, String path, Object body, boolean csrf) throws Exception {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
            if (csrf) {
                var token = json(send("GET",path.startsWith("/api/platform-admin/") ? "/api/platform-admin/v1/auth/csrf" : "/api/v1/auth/csrf",null,false));
                request.header(token.get("headerName").asString(),token.get("token").asString());
            }
            request.header("Content-Type","application/json");
            request.method(method,body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
            return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
        }
        JsonNode ok(String method, String path, Object body, int expected) throws Exception {
            var response = send(method,path,body,!"GET".equals(method));
            assertEquals(expected,response.statusCode(),response.body());
            return response.body().isEmpty() ? null : json(response);
        }
        JsonNode login(String email) throws Exception { return ok("POST",platformRealm ? "/api/platform-admin/v1/auth/login" : "/api/v1/auth/login",Map.of(platformRealm ? "username" : "email",email,"password",PASSWORD),200); }
    }
    JsonNode json(HttpResponse<String> response) { return JSON.readTree(response.body()); }
    String token(String invite) throws Exception {
        return JSON.readTree(Files.readString(Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"),invite + ".json"))).get("token").asString();
    }
    JsonNode create(String name, String email) throws Exception {
        return platform.ok("POST","/api/platform-admin/v1/tenants",Map.of("requestId",UUID.randomUUID(),"name",name,"adminEmail",email),201);
    }
    Client acceptNew(String invite, String email) throws Exception {
        Client user = new Client();
        user.ok("POST","/api/v1/auth/invitations/accept",Map.of("token",token(invite),"displayName","合成账号","password",PASSWORD),200);
        user.login(email); return user;
    }
    String invitation(Client admin, String tenant, String email) throws Exception {
        return admin.ok("POST","/api/tenant-admin/v1/tenants/" + tenant + "/invitations",Map.of("requestId",UUID.randomUUID(),"email",email),201).get("id").asString();
    }
    @BeforeAll void setup() throws Exception {
        platformId = identities.bootstrap("platform@example.test","合成平台管理员",PASSWORD);
        platform = new Client(true); platform.login("platform@example.test");
        var a = create("合成企业 A","admin-a@example.test"); tenantA = a.get("tenant").get("id").asString();
        adminA = acceptNew(a.get("invitation").get("id").asString(),"admin-a@example.test");
        var b = create("合成企业 B","admin-b@example.test"); tenantB = b.get("tenant").get("id").asString();
        adminB = acceptNew(b.get("invitation").get("id").asString(),"admin-b@example.test");
        employee = acceptNew(invitation(adminA,tenantA,"employee@example.test"),"employee@example.test");
        employeeId = employee.ok("GET","/api/v1/me",null,200).get("account").get("id").asString();
    }
    @Test void authenticationCsrfSessionRotationAndLogout() throws Exception {
        Client user = new Client();
        assertEquals(401,user.send("GET","/api/v1/me",null,false).statusCode());
        var csrf = user.send("GET","/api/v1/auth/csrf",null,false);
        assertEquals(403,user.send("POST","/api/v1/auth/login",Map.of("email","employee@example.test","password",PASSWORD),false).statusCode());
        String cookie = csrf.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(cookie.contains("HttpOnly")); assertTrue(cookie.contains("SameSite=Lax")); assertTrue(cookie.contains("DREAMCORE_SESSION="));
        String before = user.cookies.getCookieStore().getCookies().getFirst().getValue();
        assertEquals(401,user.send("POST","/api/v1/auth/login",Map.of("email","employee@example.test","password","wrong"),true).statusCode());
        user.login(" EMPLOYEE@EXAMPLE.TEST ");
        String after = user.cookies.getCookieStore().getCookies().getFirst().getValue();
        assertNotEquals(before,after);
        // An old, valid CSRF token must stop working after login.
        var old = json(csrf);
        var rejected = user.http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/auth/logout"))
                .header(old.get("headerName").asString(),old.get("token").asString()).POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(403,rejected.statusCode());
        user.ok("POST","/api/v1/auth/logout",null,204);
        assertEquals(401,user.send("GET","/api/v1/me",null,false).statusCode());
    }
    @Test void rolesNeverGrantCrossTenantOrPrivateWorkspaceAccess() throws Exception {
        for (Client forbidden : List.of(platform,adminB)) {
            assertEquals(forbidden.platformRealm ? 401 : 403,forbidden.send("GET","/api/v1/tenants/"+tenantA+"/context",null,false).statusCode());
            assertEquals(forbidden.platformRealm ? 401 : 403,forbidden.send("GET","/api/tenant-admin/v1/tenants/"+tenantA+"/invitations",null,false).statusCode());
        }
        assertEquals(403,employee.send("GET","/api/tenant-admin/v1/tenants/"+tenantA+"/invitations",null,false).statusCode());
        assertEquals(401,adminA.send("GET","/api/platform-admin/v1/tenants",null,false).statusCode());
        var adminSpaces = adminA.ok("GET","/api/v1/tenants/"+tenantA+"/context",null,200).get("workspaces");
        var employeeSpaces = employee.ok("GET","/api/v1/tenants/"+tenantA+"/context",null,200).get("workspaces");
        assertEquals(1,adminSpaces.size()); assertEquals(1,employeeSpaces.size());
        assertNotEquals(adminSpaces.get(0).get("id"),employeeSpaces.get(0).get("id"));
        var operations = platform.ok("GET","/api/platform-admin/v1/tenants",null,200);
        assertTrue(operations.isArray());
        for (var tenant : operations) assertEquals(6,tenant.size()); // id/name/status plus opening time, member count and owner metadata
        assertEquals(404,platform.send("GET","/api/platform-admin/v1/tenants/"+tenantA+"/content",null,false).statusCode());
    }
    @Test void tenantForeignKeysAndRequestSchemaRejectPrivilegeInjection() throws Exception {
        String employeeSpace = employee.ok("GET","/api/v1/tenants/"+tenantA+"/context",null,200).get("workspaces").get(0).get("id").asString();
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> db.update(
                "INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",UUID.fromString(tenantB),UUID.fromString(employeeSpace),UUID.fromString(employeeId)));
        assertEquals(400,adminA.send("POST","/api/tenant-admin/v1/tenants/"+tenantA+"/invitations",
                Map.of("requestId",UUID.randomUUID(),"email","injected@example.test","role","PLATFORM_ADMIN"),true).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM invitations WHERE email='injected@example.test'",Integer.class));
    }

    @Test void invitationRetriesAndConcurrentAcceptanceAreAtomic() throws Exception {
        UUID request = UUID.randomUUID();
        var body = Map.of("requestId",request,"email","concurrent@example.test");
        String path = "/api/tenant-admin/v1/tenants/"+tenantA+"/invitations";
        var first = adminA.ok("POST",path,body,201);
        assertEquals(first,adminA.ok("POST",path,body,201));
        assertEquals(409,adminA.send("POST",path,Map.of("requestId",request,"email","changed@example.test"),true).statusCode());
        String inviteToken = token(first.get("id").asString());
        assertFalse(first.toString().contains(inviteToken)); assertFalse(first.has("tokenHash"));
        var accept = Map.of("token",inviteToken,"displayName","并发合成账号","password",PASSWORD);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var one = executor.submit(() -> new Client().send("POST","/api/v1/auth/invitations/accept",accept,true).statusCode());
            var two = executor.submit(() -> new Client().send("POST","/api/v1/auth/invitations/accept",accept,true).statusCode());
            assertEquals(List.of(200,409),java.util.stream.Stream.of(one.get(),two.get()).sorted().toList());
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM accounts WHERE email='concurrent@example.test'",Integer.class));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM workspaces w JOIN accounts a ON a.id=w.owner_id WHERE a.email='concurrent@example.test'",Integer.class));
    }
    @Test void expiredRevokedAndForeignInvitationsCannotBeAcceptedOrRevoked() throws Exception {
        String expired = invitation(adminA,tenantA,"expired@example.test");
        db.update("UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE id=?",UUID.fromString(expired));
        String revoked = invitation(adminA,tenantA,"revoked@example.test");
        String revokePath = "/api/tenant-admin/v1/tenants/"+tenantA+"/invitations/"+revoked;
        assertEquals(403,adminB.send("DELETE",revokePath,null,true).statusCode());
        assertEquals(404,adminB.send("DELETE","/api/tenant-admin/v1/tenants/"+tenantB+"/invitations/"+revoked,null,true).statusCode());
        adminA.ok("DELETE",revokePath,null,204); adminA.ok("DELETE",revokePath,null,204);
        for (String id : List.of(expired,revoked)) {
            assertEquals(409,new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",token(id),"displayName","不可创建","password",PASSWORD),true).statusCode());
        }
        assertEquals(0,db.queryForObject("SELECT count(*) FROM accounts WHERE email IN ('expired@example.test','revoked@example.test')",Integer.class));
        assertTrue(adminA.ok("GET","/api/tenant-admin/v1/tenants/"+tenantA+"/invitations",null,200).toString().contains("EXPIRED"));
    }
    @Test void existingAccountRequiresItsOwnSessionAndCannotResetPassword() throws Exception {
        String invite = invitation(adminB,tenantB,"employee@example.test");
        String token = token(invite);
        assertEquals(403,new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",token,"displayName","攻击","password","a-different-secret-pass"),true).statusCode());
        assertEquals(403,adminA.send("POST","/api/v1/auth/invitations/accept",Map.of("token",token),true).statusCode());
        assertEquals(400,employee.send("POST","/api/v1/auth/invitations/accept",Map.of("token",token,"password","a-different-secret-pass"),true).statusCode());
        employee.ok("POST","/api/v1/auth/invitations/accept",Map.of("token",token),200);
        assertEquals("MEMBER",employee.ok("GET","/api/v1/tenants/"+tenantB+"/context",null,200).get("role").asString());
        new Client().login("employee@example.test");
        assertEquals(1,db.queryForObject("SELECT count(*) FROM accounts WHERE email='employee@example.test'",Integer.class));
    }
    @Test void disabledMembershipTenantAndAccountTakeEffectOnExistingSessions() throws Exception {
        String id = invitation(adminA,tenantA,"disable@example.test");
        Client user = acceptNew(id,"disable@example.test");
        UUID account = UUID.fromString(user.ok("GET","/api/v1/me",null,200).get("account").get("id").asString());
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE account_id=?",account);
        assertEquals(403,user.send("GET","/api/v1/tenants/"+tenantA+"/context",null,false).statusCode());
        db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE account_id=?",account);
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",UUID.fromString(tenantA));
        try { assertEquals(403,adminA.send("GET","/api/v1/tenants/"+tenantA+"/context",null,false).statusCode()); }
        finally { db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",UUID.fromString(tenantA)); }
        db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",account);
        assertEquals(401,user.send("GET","/api/v1/me",null,false).statusCode());
        assertEquals(401,user.send("POST","/api/v1/auth/login",Map.of("email","disable@example.test","password",PASSWORD),true).statusCode());
    }
    @Test void rateLimitsArePersistedAndErrorsDoNotEnumerateAccounts() throws Exception {
        Client user = new Client();
        for (int i=0;i<20;i++) assertEquals(401,user.send("POST","/api/v1/auth/login",Map.of("email","unknown@example.test","password","wrong"),true).statusCode());
        var limited = user.send("POST","/api/v1/auth/login",Map.of("email","unknown@example.test","password","wrong"),true);
        assertEquals(429,limited.statusCode()); assertFalse(limited.body().contains("unknown@example.test"));
        assertTrue(db.queryForObject("SELECT count(*) FROM login_attempts",Integer.class)>0);
    }

    @Test void tenantCreationRetryDoesNotDuplicateTenantOrInvitation() throws Exception {
        UUID requestId = UUID.randomUUID();
        var body = Map.of("requestId",requestId,"name","重试合成企业","adminEmail","retry-admin@example.test");
        var first = platform.ok("POST","/api/platform-admin/v1/tenants",body,201);
        assertEquals(first,platform.ok("POST","/api/platform-admin/v1/tenants",body,201));
        assertEquals(409,platform.send("POST","/api/platform-admin/v1/tenants",Map.of("requestId",requestId,"name","另一名称","adminEmail","retry-admin@example.test"),true).statusCode());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenants WHERE name='重试合成企业'",Integer.class));
    }
    @Test void failedDeliveryRollsBackTenantAndInvitation() throws Exception {
        Path outbox = Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"));
        Path saved = outbox.resolveSibling("saved-invitations");
        Files.move(outbox,saved);
        try {
            Files.writeString(outbox,"synthetic obstruction");
            var result = platform.send("POST","/api/platform-admin/v1/tenants",Map.of("requestId",UUID.randomUUID(),"name","不可遗留企业","adminEmail","delivery-fail@example.test"),true);
            assertEquals(503,result.statusCode());
            assertFalse(result.body().contains(outbox.toString()));
            assertEquals(0,db.queryForObject("SELECT count(*) FROM tenants WHERE name='不可遗留企业'",Integer.class));
            assertEquals(0,db.queryForObject("SELECT count(*) FROM invitations WHERE email='delivery-fail@example.test'",Integer.class));
        } finally { Files.deleteIfExists(outbox); Files.move(saved,outbox); }
    }
    @Test void expiredSessionAndRemovedPlatformRoleAreRejected() throws Exception {
        Client user = new Client(); user.login("employee@example.test");
        db.update("UPDATE spring_session SET last_access_time=0,expiry_time=0 WHERE principal_name=?",employeeId);
        assertEquals(401,user.send("GET","/api/v1/me",null,false).statusCode());
        // Restore the shared fixture's session for independent tests.
        employee.login("employee@example.test");
        db.update("DELETE FROM platform_roles WHERE account_id=?",platformId);
        try { assertEquals(401,platform.send("GET","/api/platform-admin/v1/tenants",null,false).statusCode()); }
        finally { db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platformId); platform.login("platform@example.test"); }
    }

    @Test void bootstrapCannotRunTwiceAndAuditNeverContainsCredentials() throws Exception {
        assertThrows(IdentityException.class, () -> identities.bootstrap("other-platform@example.test","合成",PASSWORD));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM platform_roles",Integer.class));
        String audit = db.queryForList("SELECT * FROM identity_audit").toString();
        assertFalse(audit.contains(PASSWORD)); assertFalse(audit.contains("@example.test")); assertFalse(audit.contains("token"));
        assertTrue(audit.contains("INVITATION_ACCEPT"));
        assertTrue(db.queryForObject("SELECT password_hash FROM accounts WHERE id=?",String.class,platformId).startsWith("{pbkdf2-sha256-v1}"));
        assertFalse(db.queryForList("SELECT * FROM invitations").toString().contains(token(invitation(adminA,tenantA,"hash-check@example.test"))));
    }
    @Test void platformCatalogAndDetailsExposeOnlyManagementMetadata() throws Exception {
        var created=create("平台目录合成_%企业","catalog-admin@example.test");
        String id=created.get("tenant").get("id").asString();
        String path="/api/platform-admin/v1/tenants/"+id;
        var detail=platform.ok("GET",path,null,200);
        assertEquals(7,detail.size());
        assertEquals(0,detail.get("version").asLong());
        assertEquals(0,detail.get("activeMemberCount").asLong());
        assertEquals("catalog-admin@example.test",detail.get("initialAdminInvitation").get("email").asString());
        assertFalse(detail.toString().contains(token(created.get("invitation").get("id").asString())));
        assertFalse(detail.has("workspaces")); assertFalse(detail.has("members"));
        var filtered=platform.ok("GET","/api/platform-admin/v1/tenants?q=%25&status=ACTIVE&limit=1",null,200);
        assertEquals(1,filtered.size()); assertEquals(id,filtered.get(0).get("id").asString());
        assertEquals(0,platform.ok("GET","/api/platform-admin/v1/tenants?q=%25&offset=1&limit=1",null,200).size());
        for(String invalid:List.of("limit=101","offset=-1","status=UNKNOWN"))
            assertEquals(400,platform.send("GET","/api/platform-admin/v1/tenants?"+invalid,null,false).statusCode());
        var runtime=platform.ok("GET","/api/platform-admin/v1/overview",null,200);
        assertEquals("LOCAL",runtime.get("invitationDelivery").asString());
        assertEquals(runtime.get("totalTenants").asLong(),runtime.get("activeTenants").asLong()+runtime.get("suspendedTenants").asLong());
        for(Client forbidden:List.of(adminA,employee)) {
            for(String denied:List.of(path,path+"/records","/api/platform-admin/v1/overview"))
                assertEquals(401,forbidden.send("GET",denied,null,false).statusCode());
            assertEquals(401,forbidden.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED"),true).statusCode());
            assertEquals(401,forbidden.send("POST",path+"/initial-admin-invitation",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"email","forbidden@example.test"),true).statusCode());
        }
        assertEquals(403,platform.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED"),false).statusCode());
        assertEquals(404,platform.send("GET","/api/platform-admin/v1/tenants/"+UUID.randomUUID(),null,false).statusCode());
        assertEquals(401,platform.send("GET","/api/v1/tenants/"+id+"/context",null,false).statusCode());
        for(String forbidden:List.of("content","conversations","impersonate")) assertEquals(404,platform.send("GET",path+"/"+forbidden,null,false).statusCode());
    }
    @Test void platformSuspensionIsVersionedIdempotentAndTenantScoped() throws Exception {
        var created=create("状态验证合成企业","suspend-admin@example.test");
        String id=created.get("tenant").get("id").asString(), path="/api/platform-admin/v1/tenants/"+id;
        Client user=acceptNew(created.get("invitation").get("id").asString(),"suspend-admin@example.test");
        user.ok("POST","/api/v1/auth/invitations/accept",Map.of("token",token(invitation(adminA,tenantA,"suspend-admin@example.test"))),200);
        String pending=invitation(user,id,"suspend-pending@example.test");
        var suspend=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED");
        var stopped=platform.ok("POST",path+"/status",suspend,200);
        assertEquals(1,stopped.get("version").asLong());
        assertEquals(stopped,platform.ok("POST",path+"/status",suspend,200));
        assertEquals(403,user.send("GET","/api/v1/tenants/"+id+"/context",null,false).statusCode());
        user.ok("GET","/api/v1/tenants/"+tenantA+"/context",null,200);
        assertEquals(403,user.send("POST","/api/tenant-admin/v1/tenants/"+id+"/invitations",Map.of("requestId",UUID.randomUUID(),"email","stop-denied@example.test"),true).statusCode());
        var accept=Map.of("token",token(pending),"displayName","合成待加入","password",PASSWORD);
        assertEquals(403,new Client().send("POST","/api/v1/auth/invitations/accept",accept,true).statusCode());
        assertEquals(409,platform.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","ACTIVE"),true).statusCode());
        assertEquals(400,platform.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","DELETED"),true).statusCode());
        var resumed=platform.ok("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","ACTIVE"),200);
        assertEquals(2,resumed.get("version").asLong());
        // An old retry must not suspend the tenant after another operation restored it.
        assertEquals("ACTIVE",platform.ok("POST",path+"/status",suspend,200).get("tenant").get("status").asString());
        user.ok("GET","/api/v1/tenants/"+id+"/context",null,200);
        new Client().ok("POST","/api/v1/auth/invitations/accept",accept,200);
        var records=platform.ok("GET",path+"/records",null,200);
        assertEquals(List.of("TENANT_RESUME","TENANT_SUSPEND","TENANT_CREATE"),java.util.stream.StreamSupport.stream(records.spliterator(),false).map(n->n.get("action").asString()).toList());
        assertFalse(records.toString().contains("suspend-pending@example.test"));
    }
    @Test void initialOwnerProjectionAndRevokeAreVersionedAndDoNotReplaceAcceptedOwner() throws Exception {
        var created=platform.ok("POST","/api/platform-admin/v1/tenants",Map.of("requestId",UUID.randomUUID(),"name","负责人投影合成企业","adminEmail","owner-projection@example.test","designateAuthorizationOwner",true),201);
        String id=created.get("tenant").get("id").asString(),path="/api/platform-admin/v1/tenants/"+id;
        String original=created.get("invitation").get("id").asString();
        assertEquals("AWAITING_INVITATION",platform.ok("GET",path,null,200).get("owner").get("state").asString());
        var revoke=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0);
        assertEquals(401,adminA.send("POST",path+"/initial-admin-invitation/revoke",revoke,true).statusCode());
        assertEquals(403,platform.send("POST",path+"/initial-admin-invitation/revoke",revoke,false).statusCode());
        var revoked=platform.ok("POST",path+"/initial-admin-invitation/revoke",revoke,200);
        assertEquals("INVITATION_INACTIVE",revoked.get("owner").get("state").asString());
        assertEquals(revoked,platform.ok("POST",path+"/initial-admin-invitation/revoke",revoke,200));
        assertEquals(409,new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",token(original),"displayName","合成","password",PASSWORD),true).statusCode());
        assertEquals(409,platform.send("POST",path+"/initial-admin-invitation/revoke",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0),true).statusCode());
        var next=platform.ok("POST",path+"/initial-admin-invitation",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"email","owner-projection@example.test"),200);
        // Replaying a prior revocation cannot revoke the new invitation.
        assertEquals("PENDING",platform.ok("POST",path+"/initial-admin-invitation/revoke",revoke,200).get("initialAdminInvitation").get("status").asString());
        Client owner=acceptNew(next.get("initialAdminInvitation").get("id").asString(),"owner-projection@example.test");
        assertEquals("AWAITING_RESPONSIBILITY",platform.ok("GET",path,null,200).get("owner").get("state").asString());
        assertEquals(409,platform.send("POST",path+"/initial-admin-invitation/revoke",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2),true).statusCode());
        String governance="/api/v1/tenants/"+id+"/governance";
        var snapshot=owner.ok("GET",governance,null,200);
        owner.ok("POST",governance+"/accept-initial-responsibility",Map.of("requestId",UUID.randomUUID(),"expectedVersion",snapshot.get("revision").asLong()),200);
        var assigned=platform.ok("GET",path,null,200).get("owner");
        assertEquals("ASSIGNED",assigned.get("state").asString());
        assertEquals("合成账号",assigned.get("name").asString());
        var catalog=platform.ok("GET","/api/platform-admin/v1/tenants?q="+java.net.URLEncoder.encode("负责人投影合成企业",java.nio.charset.StandardCharsets.UTF_8),null,200).get(0);
        assertEquals(assigned,catalog.get("owner"));assertEquals(1,catalog.get("activeMemberCount").asLong());
        assertTrue(catalog.has("createdAt"));assertFalse(catalog.toString().contains("owner-projection@example.test"));
        assertEquals(1,java.util.stream.StreamSupport.stream(platform.ok("GET",path+"/records",null,200).spliterator(),false).filter(n->n.get("action").asString().equals("INITIAL_ADMIN_INVITATION_REVOKE")).count());
    }
    @Test void revokeAndAcceptInitialInvitationCannotBothSucceed() throws Exception {
        var created=create("初始邀请并发合成企业","initial-revoke-race@example.test");
        String id=created.get("tenant").get("id").asString(),invite=created.get("invitation").get("id").asString();
        String token=token(invite);
        try(var executor=Executors.newFixedThreadPool(2)) {
            var revoke=executor.submit(()->platform.send("POST","/api/platform-admin/v1/tenants/"+id+"/initial-admin-invitation/revoke",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0),true).statusCode());
            var accept=executor.submit(()->new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",token,"displayName","合成并发","password",PASSWORD),true).statusCode());
            assertEquals(List.of(200,409),java.util.stream.Stream.of(revoke.get(15,java.util.concurrent.TimeUnit.SECONDS),accept.get(15,java.util.concurrent.TimeUnit.SECONDS)).sorted().toList());
        }
    }
    @Test void initialAdminReplacementInvalidatesOldInvitationAndRollsBackFailedDelivery() throws Exception {
        var created=create("初始邀请合成企业","initial-old@example.test");
        String id=created.get("tenant").get("id").asString(),path="/api/platform-admin/v1/tenants/"+id;
        String old=created.get("invitation").get("id").asString();
        var body=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"email","initial-new@example.test");
        var replaced=platform.ok("POST",path+"/initial-admin-invitation",body,200);
        assertEquals(replaced,platform.ok("POST",path+"/initial-admin-invitation",body,200));
        assertEquals(409,new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",token(old),"displayName","旧邀请","password",PASSWORD),true).statusCode());
        String current=replaced.get("initialAdminInvitation").get("id").asString();
        Path outbox=Path.of(env.getRequiredProperty("dreamcore.invitation.outbox")),saved=outbox.resolveSibling("b2-saved-outbox");
        Files.move(outbox,saved);
        try {
            Files.writeString(outbox,"synthetic obstruction");
            assertEquals(503,platform.send("POST",path+"/initial-admin-invitation",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"email","initial-failed@example.test"),true).statusCode());
            var unchanged=platform.ok("GET",path,null,200);
            assertEquals(1,unchanged.get("version").asLong());
            assertEquals(current,unchanged.get("initialAdminInvitation").get("id").asString());
            assertEquals("PENDING",unchanged.get("initialAdminInvitation").get("status").asString());
        } finally { Files.deleteIfExists(outbox); Files.move(saved,outbox); }
        acceptNew(current,"initial-new@example.test");
        assertEquals(409,platform.send("POST",path+"/initial-admin-invitation",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"email","initial-takeover@example.test"),true).statusCode());
        assertEquals("ACCEPTED",platform.ok("GET",path,null,200).get("initialAdminInvitation").get("status").asString());
    }
    @Test void concurrentPlatformTransitionsAndInvitationAcceptanceStayAtomic() throws Exception {
        var created=create("并发总台合成企业","platform-race@example.test");
        String id=created.get("tenant").get("id").asString(),path="/api/platform-admin/v1/tenants/"+id;
        Client peer=new Client(true);peer.login("platform@example.test");
        try(var executor=Executors.newFixedThreadPool(2)) {
            var one=executor.submit(()->platform.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED"),true).statusCode());
            var two=executor.submit(()->peer.send("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED"),true).statusCode());
            assertEquals(List.of(200,409),java.util.stream.Stream.of(one.get(15,java.util.concurrent.TimeUnit.SECONDS),two.get(15,java.util.concurrent.TimeUnit.SECONDS)).sorted().toList());
        }
        platform.ok("POST",path+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","ACTIVE"),200);
        String secret=token(created.get("invitation").get("id").asString());
        try(var executor=Executors.newFixedThreadPool(2)) {
            var accept=executor.submit(()->new Client().send("POST","/api/v1/auth/invitations/accept",Map.of("token",secret,"displayName","并发加入","password",PASSWORD),true).statusCode());
            var rotate=executor.submit(()->platform.send("POST",path+"/initial-admin-invitation",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"email","platform-race@example.test"),true).statusCode());
            assertEquals(List.of(200,409),java.util.stream.Stream.of(accept.get(15,java.util.concurrent.TimeUnit.SECONDS),rotate.get(15,java.util.concurrent.TimeUnit.SECONDS)).sorted().toList());
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='TENANT_SUSPEND'",Integer.class,UUID.fromString(id)));
    }
    @Test void populatedV2DatabaseMigratesInitialInvitationAndEnforcesTenantForeignKey() {
        String schema="b2_migration_"+UUID.randomUUID().toString().replace("-","");
        UUID account=UUID.randomUUID(),tenant=UUID.randomUUID(),other=UUID.randomUUID(),first=UUID.randomUUID(),later=UUID.randomUUID();
        try {
            org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("2").load().migrate();
            db.update("INSERT INTO "+schema+".accounts(id,email,display_name,password_hash) VALUES (?,'migration@example.test','合成','synthetic')",account);
            db.update("INSERT INTO "+schema+".tenants(id,name) VALUES (?,'迁移合成企业'),(?,'另一合成企业')",tenant,other);
            db.update("INSERT INTO "+schema+".invitations(id,tenant_id,email,role,token_hash,expires_at,created_by,created_at) VALUES (?,?,'first@example.test','TENANT_ADMIN','first',now()+interval '1 day',?,now()-interval '1 day'),(?,?,'later@example.test','TENANT_ADMIN','later',now()+interval '1 day',?,now())",first,tenant,account,later,tenant,account);
            UUID shared=UUID.randomUUID(),personal=UUID.randomUUID();
            db.update("INSERT INTO "+schema+".tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,account);
            db.update("INSERT INTO "+schema+".workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'旧共享空间','SHARED'),(?,?,?,'旧个人空间','PERSONAL')",shared,tenant,account,personal,tenant,account);
            org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).load().migrate();
            assertEquals(0,db.queryForObject("SELECT settings_version FROM "+schema+".tenants WHERE id=?",Long.class,tenant));
            assertEquals(0,db.queryForObject("SELECT management_version FROM "+schema+".tenant_memberships WHERE tenant_id=?",Long.class,tenant));
            assertEquals(0,db.queryForObject("SELECT management_version FROM "+schema+".workspaces WHERE id=?",Long.class,shared));
            assertEquals(List.of(shared),db.queryForList("SELECT workspace_id FROM "+schema+".workspace_members",UUID.class));
            assertFalse(db.queryForObject("SELECT can_maintain FROM "+schema+".workspace_members WHERE workspace_id=?",Boolean.class,shared));
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->db.update("UPDATE "+schema+".tenant_memberships SET management_version=-1 WHERE tenant_id=?",tenant));
            assertEquals(first,db.queryForObject("SELECT invitation_id FROM "+schema+".tenant_initial_admin WHERE tenant_id=?",UUID.class,tenant));
            assertEquals(0,db.queryForObject("SELECT management_version FROM "+schema+".tenants WHERE id=?",Long.class,tenant));
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->db.update("INSERT INTO "+schema+".tenant_initial_admin(tenant_id,invitation_id) VALUES (?,?)",other,later));
        } finally { db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE"); }
    }

    record ManagedFixture(String tenant, String path, Client admin, String adminId) {}
    ManagedFixture managed(String label) throws Exception {
        String email=label+"@example.test";var created=create("企业管理合成 "+label,email);
        String tenant=created.get("tenant").get("id").asString();Client admin=acceptNew(created.get("invitation").get("id").asString(),email);
        return new ManagedFixture(tenant,"/api/tenant-admin/v1/tenants/"+tenant,admin,admin.ok("GET","/api/v1/me",null,200).get("account").get("id").asString());
    }
    String accountId(Client client) throws Exception { return client.ok("GET","/api/v1/me",null,200).get("account").get("id").asString(); }
    @Test void tenantManagementRequiresLiveOwnTenantAdminAndNeverListsPersonalSpaces() throws Exception {
        var f=managed("b3-isolation");Client member=acceptNew(invitation(f.admin,f.tenant,"b3-reader@example.test"),"b3-reader@example.test");
        var body=Map.of("requestId",UUID.randomUUID(),"name","共享资料","ownerId",f.adminId,"description","");var space=f.admin.ok("POST",f.path+"/workspaces",body,201);
        String id=space.get("id").asString();
        for(Client forbidden:List.of(platform,adminB,member)) {
            for(String route:List.of("/overview","/members","/workspaces","/records","/workspaces/"+id,"/workspaces/"+id+"/members","/invitations"))
                assertEquals(forbidden.platformRealm ? 401 : 403,forbidden.send("GET",f.path+route,null,false).statusCode());
            assertEquals(forbidden.platformRealm ? 401 : 403,forbidden.send("POST",f.path+"/workspaces",body,true).statusCode());
            assertEquals(forbidden.platformRealm ? 401 : 403,forbidden.send("POST",f.path+"/members/"+f.adminId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),true).statusCode());
        }
        assertEquals(403,f.admin.send("POST",f.path+"/workspaces",body,false).statusCode());
        assertEquals(400,f.admin.send("POST",f.path+"/workspaces",Map.of("requestId",UUID.randomUUID(),"name","注入","kind","PERSONAL"),true).statusCode());
        assertEquals(1,f.admin.ok("GET",f.path+"/workspaces",null,200).size());
        var personal=f.admin.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces");
        assertEquals(2,personal.size()); // Creator explicitly chose themselves as responsible owner.
        var personalId=db.queryForObject("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL'",UUID.class,UUID.fromString(f.tenant),UUID.fromString(f.adminId));
        assertEquals(404,f.admin.send("GET",f.path+"/workspaces/"+personalId.toString(),null,false).statusCode());
        assertEquals(404,adminB.send("GET","/api/tenant-admin/v1/tenants/"+tenantB+"/workspaces/"+id,null,false).statusCode());
        assertEquals(404,f.admin.send("POST",f.path+"/members/"+employeeId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),true).statusCode());
        for(String route:List.of("/members?limit=101","/workspaces?offset=-1","/members?status=UNKNOWN","/records?limit=0","/invitations?limit=101"))
            assertEquals(400,f.admin.send("GET",f.path+route,null,false).statusCode());
        assertEquals(1,f.admin.ok("GET",f.path+"/members?q=b3-reader&limit=1",null,200).size());
        assertEquals(404,f.admin.send("POST",f.path+"/members/"+accountId(member)+"/role",Map.of("role","TENANT_ADMIN"),true).statusCode());
    }
    @Test void ordinarySpaceOwnerCanManageOnlyAssignedSpaceThroughHttp() throws Exception {
        var f=managed("b3-space-responsibility");Client responsible=acceptNew(invitation(f.admin,f.tenant,"b3-space-owner@example.test"),"b3-space-owner@example.test");
        String owner=accountId(responsible);
        var space=f.admin.ok("POST",f.path+"/workspaces",Map.of("requestId",UUID.randomUUID(),"name","指定普通成员","ownerId",owner),201);
        String path=f.path+"/workspaces/"+space.get("id").asString();
        assertEquals(owner,space.get("ownerId").asString());
        assertEquals(200,responsible.send("GET",path,null,false).statusCode());
        assertEquals(200,responsible.send("GET",path+"/members",null,false).statusCode());
        assertEquals(200,responsible.send("GET",path+"/eligible-members",null,false).statusCode());
        assertEquals(403,responsible.send("GET",f.path+"/members",null,false).statusCode());
        assertEquals(403,responsible.send("POST",path+"/owner",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"ownerId",f.adminId,"previousAccess","READ"),true).statusCode());
        assertEquals(1,f.admin.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces").size());
        assertEquals(403,responsible.send("POST",path+"/members/"+f.adminId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),false).statusCode());
        assertEquals(200,responsible.send("POST",path+"/members/"+f.adminId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),true).statusCode());
        assertEquals(2,f.admin.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces").size());
    }
    @Test void sharedWorkspaceGrantsAreScopedVersionedAndOldRetriesDoNotRestoreRevokedAccess() throws Exception {
        var f=managed("b3-grants");Client reader=acceptNew(invitation(f.admin,f.tenant,"b3-granted@example.test"),"b3-granted@example.test");String account=accountId(reader);
        var create=Map.of("requestId",UUID.randomUUID(),"name","产品资料","ownerId",f.adminId,"description","");var space=f.admin.ok("POST",f.path+"/workspaces",create,201);
        assertEquals(space,f.admin.ok("POST",f.path+"/workspaces",create,201));
        assertEquals(409,f.admin.send("POST",f.path+"/workspaces",Map.of("requestId",create.get("requestId"),"name","不同内容","ownerId",f.adminId,"description",""),true).statusCode());
        String id=space.get("id").asString(),path=f.path+"/workspaces/"+id;
        assertEquals(200,f.admin.send("POST",path+"/members/"+f.adminId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),true).statusCode());
        assertEquals(404,f.admin.send("POST",path+"/members/"+employeeId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),true).statusCode());
        var grant=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true);
        var granted=f.admin.ok("POST",path+"/members/"+account,grant,200);
        assertEquals(1,granted.get("version").asLong());assertEquals(2,granted.get("memberCount").asLong());
        assertEquals(granted,f.admin.ok("POST",path+"/members/"+account,grant,200));
        assertEquals(2,reader.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces").size());
        var revoke=Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"enabled",false);
        f.admin.ok("POST",path+"/members/"+account,revoke,200);
        assertEquals(1,reader.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces").size());
        var retried=f.admin.ok("POST",path+"/members/"+account,grant,200);
        assertEquals(1,retried.get("memberCount").asLong());assertEquals(2,retried.get("version").asLong());
        assertEquals(409,f.admin.send("POST",path+"/settings",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"name","过期更新"),true).statusCode());
        f.admin.ok("POST",path+"/settings",Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"name","产品资料二"),200);
        var records=f.admin.ok("GET",f.path+"/records",null,200);
        assertTrue(records.toString().contains("WORKSPACE_REVOKE"));assertTrue(records.toString().contains(account));
        assertFalse(records.toString().contains("password"));assertFalse(records.toString().contains("token"));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='WORKSPACE_GRANT'",Integer.class,UUID.fromString(f.tenant)));
    }
    @Test void memberDisableRevokesExistingSessionOnlyInThisTenantAndRestoreKeepsOriginalGrants() throws Exception {
        var f=managed("b3-disable");String email="b3-multitenant@example.test";Client reader=acceptNew(invitation(f.admin,f.tenant,email),email);String account=accountId(reader);
        reader.ok("POST","/api/v1/auth/invitations/accept",Map.of("token",token(invitation(adminB,tenantB,email))),200);
        String id=f.admin.ok("POST",f.path+"/workspaces",Map.of("requestId",UUID.randomUUID(),"name","停用验证","ownerId",f.adminId,"description",""),201).get("id").asString();
        f.admin.ok("POST",f.path+"/workspaces/"+id+"/members/"+account,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),200);
        String path=f.path+"/members/"+account+"/status";var disable=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED");
        f.admin.ok("POST",path,disable,200);f.admin.ok("POST",path,disable,200);
        assertEquals(403,reader.send("GET","/api/v1/tenants/"+f.tenant+"/context",null,false).statusCode());
        reader.ok("GET","/api/v1/tenants/"+tenantB+"/context",null,200);
        assertEquals(409,f.admin.send("POST",f.path+"/workspaces/"+id+"/members/"+account,Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"enabled",true),true).statusCode());
        assertEquals(409,f.admin.send("POST",path,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","ACTIVE"),true).statusCode());
        f.admin.ok("POST",path,Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","ACTIVE"),200);
        assertEquals("ACTIVE",f.admin.ok("POST",path,disable,200).get("status").asString());
        assertEquals(2,reader.ok("GET","/api/v1/tenants/"+f.tenant+"/context",null,200).get("workspaces").size());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='MEMBER_DISABLE'",Integer.class,UUID.fromString(f.tenant)));
        assertEquals("LAST_TENANT_ADMIN",json(f.admin.send("POST",f.path+"/members/"+f.adminId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),true)).get("code").asString());
    }
    @Test void concurrentAdminDisablesCannotRemoveAllAdminsAndRemovedAdminCannotKeepWriting() throws Exception {
        var f=managed("b3-last-admin");Client peer=acceptNew(invitation(f.admin,f.tenant,"b3-second-admin@example.test"),"b3-second-admin@example.test");String peerId=accountId(peer);
        // Synthetic second administrator fixture; the role-assignment product feature is not enabled.
        db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",UUID.fromString(f.tenant),UUID.fromString(peerId));
        try(var executor=Executors.newFixedThreadPool(2)) {
            var one=executor.submit(()->f.admin.send("POST",f.path+"/members/"+peerId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),true).statusCode());
            var two=executor.submit(()->peer.send("POST",f.path+"/members/"+f.adminId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),true).statusCode());
            assertEquals(List.of(200,403),java.util.stream.Stream.of(one.get(15,java.util.concurrent.TimeUnit.SECONDS),two.get(15,java.util.concurrent.TimeUnit.SECONDS)).sorted().toList());
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND role='TENANT_ADMIN' AND status='ACTIVE'",Integer.class,UUID.fromString(f.tenant)));
        String disabled=db.queryForObject("SELECT account_id FROM tenant_memberships WHERE tenant_id=? AND status='DISABLED'",UUID.class,UUID.fromString(f.tenant)).toString();
        Client removed=disabled.equals(f.adminId)?f.admin:peer;
        assertEquals(403,removed.send("POST",f.path+"/invitations",Map.of("requestId",UUID.randomUUID(),"email","b3-removed-invite@example.test"),true).statusCode());
    }
    @Test void tenantSettingsAndWorkspaceConcurrencyRejectStaleWritesAndStayIndependentOfPlatformStateVersion() throws Exception {
        var f=managed("b3-versions");String id=f.admin.ok("POST",f.path+"/workspaces",Map.of("requestId",UUID.randomUUID(),"name","版本测试","ownerId",f.adminId,"description",""),201).get("id").asString();
        Client peer=new Client();peer.login("b3-versions@example.test");
        try(var executor=Executors.newFixedThreadPool(2)) {
            var one=executor.submit(()->f.admin.send("POST",f.path+"/workspaces/"+id+"/settings",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"name","名称一"),true).statusCode());
            var two=executor.submit(()->peer.send("POST",f.path+"/workspaces/"+id+"/settings",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"name","名称二"),true).statusCode());
            assertEquals(List.of(200,409),java.util.stream.Stream.of(one.get(15,java.util.concurrent.TimeUnit.SECONDS),two.get(15,java.util.concurrent.TimeUnit.SECONDS)).sorted().toList());
        }
        var rename=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"name","新企业名称");
        assertEquals(1,f.admin.ok("POST",f.path+"/settings",rename,200).get("version").asLong());
        assertEquals("新企业名称",f.admin.ok("POST",f.path+"/settings",rename,200).get("name").asString());
        assertEquals(0,platform.ok("GET","/api/platform-admin/v1/tenants/"+f.tenant,null,200).get("version").asLong());
        platform.ok("POST","/api/platform-admin/v1/tenants/"+f.tenant+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","SUSPENDED"),200);
        assertEquals(403,f.admin.send("GET",f.path+"/overview",null,false).statusCode());
        assertEquals(403,f.admin.send("POST",f.path+"/settings",rename,true).statusCode());
    }

    @Test void requestsWaitingForTenantLockRecheckMembershipAfterRevocationCommits() throws Exception {
        var f=managed("b3-lock-recheck");Client peer=new Client();peer.login("b3-lock-recheck@example.test");
        try(var connection=db.getDataSource().getConnection();var executor=Executors.newFixedThreadPool(2)) {
            connection.setAutoCommit(false);
            try {
                try(var lock=connection.prepareStatement("SELECT id FROM tenants WHERE id=? FOR UPDATE")) {
                    lock.setObject(1,UUID.fromString(f.tenant));lock.executeQuery().close();
                }
                try(var disable=connection.prepareStatement("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?")) {
                    disable.setObject(1,UUID.fromString(f.tenant));disable.setObject(2,UUID.fromString(f.adminId));disable.executeUpdate();
                }
                var read=executor.submit(()->peer.send("GET","/api/v1/tenants/"+f.tenant+"/context",null,false).statusCode());
                var invite=executor.submit(()->f.admin.send("POST",f.path+"/invitations",Map.of("requestId",UUID.randomUUID(),"email","b3-after-revocation@example.test"),true).statusCode());
                long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
                boolean waiting=false;
                while(System.nanoTime()<deadline) {
                    if (db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%'",Integer.class)>=2) { waiting=true;break; }
                    Thread.sleep(20);
                }
                assertTrue(waiting,"Both requests must be waiting for the tenant lock before revocation commits");
                connection.commit();
                assertEquals(403,read.get(10,java.util.concurrent.TimeUnit.SECONDS));
                assertEquals(403,invite.get(10,java.util.concurrent.TimeUnit.SECONDS));
                assertEquals(0,db.queryForObject("SELECT count(*) FROM invitations WHERE email='b3-after-revocation@example.test'",Integer.class));
            } finally { connection.rollback(); }
        }
    }

}
