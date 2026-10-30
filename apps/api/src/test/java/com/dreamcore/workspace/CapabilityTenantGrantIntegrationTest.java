package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityService;
import java.net.URI;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CapabilityTenantGrantIntegrationTest {
    private String path() { return "/api/agent-admin/v1/tenants/" + tenant + "/grants"; }
    private UUID tenant, other;
    private static final String BODY = "{\"capabilityId\":\"quality-check\",\"enterpriseFunction\":\"quality-check\"}";
    private static final String AUTH = "/api/agent-admin/v1/auth";
    private static final String PASSWORD = "synthetic-only-password-034";
    private String sessionToken;
    private String csrf;
    private UUID actor;
    @DynamicPropertySource
    static void isolateDatabase(DynamicPropertyRegistry registry) { IsolatedTestDatabase.register(registry); }
    @LocalServerPort int port;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    private final HttpClient http = HttpClient.newHttpClient();

    @BeforeEach void fixture() throws Exception {
        db.update("DELETE FROM qo_capability_tenant_grant");
        db.update("DELETE FROM qo_capability");
        tenant = UUID.randomUUID(); other = UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,?),(?,?)", tenant,"合成企业甲",other,"合成企业乙");
        db.update("INSERT INTO qo_capability(capability_id,name,enterprise_function) VALUES ('quality-check','合成检查','quality-check')");
        actor = UUID.randomUUID();
        String login = "synthetic-" + actor + "@example.test";
        String hash = passwords.encode(PASSWORD);
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)", actor,login,"合成账号",hash);
        db.update("INSERT INTO agent_platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)", actor,login,hash);
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'AGENT_ADMIN')", actor);
        var cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        var browser = HttpClient.newBuilder().cookieHandler(cookies).build();
        String before = new JsonMapper().readTree(browserSend(browser, "GET", AUTH + "/csrf", null, null).body()).get("token").asString();
        var loginResponse = browserSend(browser, "POST", AUTH + "/login",
                new JsonMapper().writeValueAsString(Map.of("username",login,"password",PASSWORD)), before);
        assertEquals(200, loginResponse.statusCode(), loginResponse.body());
        sessionToken = cookies.getCookieStore().getCookies().stream()
                .filter(c -> c.getName().equals("DREAMCORE_AGENT")).findFirst().orElseThrow().getValue();
        csrf = new JsonMapper().readTree(browserSend(browser, "GET", AUTH + "/csrf", null, null).body()).get("token").asString();
        assertEquals(actor, db.queryForObject("SELECT account_id FROM agent_platform_sessions WHERE token_hash=?",
                UUID.class, IdentityService.hash(sessionToken)));
    }

    @Test void unauthenticatedWritesRejectBeforeBodyAndCsrf() throws Exception {
        for (String body : new String[]{BODY, "{", "{}"}) {
            for (String token : new String[]{null, csrf}) {
                assertError(send("POST", path(), body, null, token), 401,
                        "AUTHENTICATION_REQUIRED", "还没有登录，请先登录后再试");
            }
        }
        assertEquals(0, count());
    }

    @Test void csrfAndForeignRealmCookiesCannotWrite() throws Exception {
        for (String token : new String[]{null, "wrong"}) {
            assertError(send("POST", path(), "{", cookie(), token), 403,
                    "ACCESS_DENIED", "登录校验未通过，请刷新页面后再试");
        }
        for (String name : new String[]{"DREAMCORE_SESSION", "DREAMCORE_PLATFORM"}) {
            assertError(send("POST", path(), BODY, name + "=00000000-0000-0000-0000-0000000000aa", csrf), 401,
                    "AUTHENTICATION_REQUIRED", "还没有登录，请先登录后再试");
        }
        assertEquals(0, count());
    }

    @Test void firstWriteIsReadableDuplicateAndConflictNeverOverwrite() throws Exception {
        assertEquals(1, db.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='qo_capability_tenant_grant' AND column_name='tenant_id'", Integer.class));
        var first = send("POST", path(), BODY, cookie(), csrf);
        assertGrant(first, 201, tenant);
        String original = snapshot(tenant);
        assertEquals(1, db.queryForObject("SELECT count(*) FROM qo_capability", Integer.class));
        var row = db.queryForMap("SELECT * FROM qo_capability_tenant_grant WHERE tenant_id=?", tenant);
        assertEquals(tenant, row.get("tenant_id"));
        assertEquals("quality-check", row.get("capability_id"));
        assertEquals("quality-check", row.get("enterprise_function"));
        assertEquals(4, row.size());
        assertEquals(row.get("granted_at").toString(), java.sql.Timestamp.from(java.time.Instant.parse(new JsonMapper().readTree(first.body()).get("grantedAt").asString())).toString());
        var duplicate = send("POST", path(), BODY, cookie(), csrf);
        assertGrant(duplicate, 200, tenant);
        assertEquals(first.body(), duplicate.body());
        assertEquals(original, snapshot(tenant));
        assertEquals(1, count());
        db.update("INSERT INTO qo_capability(capability_id,name,enterprise_function) VALUES ('another-check','另一合成检查','quality-check')");
        assertError(send("POST", path(), BODY.replace("\"capabilityId\":\"quality-check\"", "\"capabilityId\":\"another-check\""), cookie(), csrf),
                409, "GRANT_ALREADY_EXISTS", "已经开通过了，不能改成另一项");
        assertEquals(original, snapshot(tenant));
        assertEquals(1, count());
        assertEquals(2, db.queryForObject("SELECT count(*) FROM qo_capability", Integer.class));
        assertEquals("quality-check", db.queryForObject("SELECT enterprise_function FROM qo_capability WHERE capability_id='quality-check'", String.class));
    }

    @Test void tenantsRemainIndependent() throws Exception {
        assertGrant(send("POST", path(), BODY, cookie(), csrf), 201, tenant);
        String original = snapshot(tenant);
        assertEquals(0, db.queryForObject("SELECT count(*) FROM qo_capability_tenant_grant WHERE tenant_id=?", Integer.class, other));
        var response = send("POST", path().replace(tenant.toString(), other.toString()), BODY, cookie(), csrf);
        assertGrant(response, 201, other);
        assertFalse(response.body().contains(tenant.toString()));
        assertEquals(original, snapshot(tenant));
        assertEquals(2, count());
    }

    @Test void unknownFieldsAreRejected() throws Exception {
        for (String key : new String[]{"moduleVersionId", "isDefault", "tenantId", "grantedBy", "grantedAt", "unknown"}) {
            assertError(send("POST", path(), BODY.replace("}", ",\"" + key + "\":null}"), cookie(), csrf),
                    400, "INVALID_REQUEST", "有无法识别的字段，请检查后再提交");
        }
        assertEquals(0, count());
    }

    @Test void invalidBodyAndPathNeverInsert() throws Exception {
        for (String body : new String[]{"{", "", "null", "[]", "{}",
                "{\"capabilityId\":\"quality-check\"}",
                BODY.replace("\"capabilityId\":\"quality-check\"", "\"capabilityId\":\" \""),
                BODY.replace("\"capabilityId\":\"quality-check\"", "\"capabilityId\":42"),
                BODY.replace("\"enterpriseFunction\":\"quality-check\"", "\"enterpriseFunction\":null"),
                BODY.replace("\"enterpriseFunction\":\"quality-check\"", "\"enterpriseFunction\":\"unknown\""),
                BODY.replace("\"enterpriseFunction\":\"quality-check\"", "\"enterpriseFunction\":\" \""),
                "{\"enterpriseFunction\":\"quality-check\"}"}) {
            assertError(send("POST", path(), body, cookie(), csrf), 400, "INVALID_REQUEST", "请按要求填写开通内容");
        }
        for (String invalid : new String[]{"not-uuid", "1-1-1-1-1"}) {
            assertError(send("POST", path().replace(tenant.toString(), invalid), BODY, cookie(), csrf),
                    400, "INVALID_REQUEST", "请按要求填写开通内容");
        }
        assertEquals(0, count());
    }

    @Test void missingTenantOrCatalogAndInvalidCatalogFunctionNeverInsert() throws Exception {
        int tenants = db.queryForObject("SELECT count(*) FROM tenants", Integer.class);
        assertError(send("POST", path().replace(tenant.toString(), UUID.randomUUID().toString()), BODY, cookie(), csrf),
                404, "TENANT_NOT_FOUND", "没有这个企业，不能开通");
        assertError(send("POST", path(), BODY.replace("quality-check", "table-compare"), cookie(), csrf),
                404, "CAPABILITY_NOT_FOUND", "还没有这项登记，请先登记再开通");
        for (String function : new String[]{null, "table-compare"}) {
            db.update("UPDATE qo_capability SET enterprise_function=? WHERE capability_id='quality-check'", function);
            assertError(send("POST", path(), BODY, cookie(), csrf), 400, "INVALID_REQUEST", "请按要求填写开通内容");
            assertEquals(function, db.queryForObject("SELECT enterprise_function FROM qo_capability WHERE capability_id='quality-check'", String.class));
        }
        assertEquals(tenants, db.queryForObject("SELECT count(*) FROM tenants", Integer.class));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM qo_capability", Integer.class));
        assertEquals(0, count());
    }

    @Test void onlyFourthEndPostIsMappedAndListStaysUnimplemented() throws Exception {
        assertFalse(mappings.getHandlerMethods().values().stream().anyMatch(h -> h.getMethod().getName().equals("listCapabilityTenantGrants")));
        var grantMappings = mappings.getHandlerMethods().entrySet().stream().filter(e ->
                e.getValue().getBeanType().getSimpleName().equals("CapabilityTenantGrantController")
                && e.getValue().getMethod().getName().equals("createCapabilityTenantGrant")).toList();
        assertEquals(1, grantMappings.size());
        assertEquals(java.util.Set.of("/api/agent-admin/v1/tenants/{tenantId}/grants"), grantMappings.getFirst().getKey().getPatternValues());
        assertEquals(java.util.Set.of(org.springframework.web.bind.annotation.RequestMethod.POST), grantMappings.getFirst().getKey().getMethodsCondition().getMethods());
        assertFalse(mappings.getHandlerMethods().keySet().stream().flatMap(m -> m.getPatternValues().stream()).anyMatch(p -> p.startsWith("/api/platform-admin") && p.contains("grants")));
        assertEquals(401, send("GET", path(), null, null, null).statusCode());
        int status = send("GET", path(), null, cookie(), csrf).statusCode();
        assertTrue(status == 404 || status == 405, "actual status=" + status);
        assertEquals(0, count());
    }

    @Test void concurrentDuplicateRequestsReturnOneCreatedAndOneExisting() throws Exception {
        var first = java.util.concurrent.CompletableFuture.supplyAsync(() -> concurrentPost());
        var second = java.util.concurrent.CompletableFuture.supplyAsync(() -> concurrentPost());
        var a = first.get(); var b = second.get();
        assertEquals(java.util.Set.of(201, 200), java.util.Set.of(a.statusCode(), b.statusCode()));
        assertEquals(a.body(), b.body());
        assertEquals(1, count());
    }

    private HttpResponse<String> concurrentPost() {
        try { return send("POST", path(), BODY, cookie(), csrf); }
        catch (Exception ex) { throw new RuntimeException(ex); }
    }

    private void assertGrant(HttpResponse<String> response, int status, UUID expected) throws Exception {
        assertEquals(status, response.statusCode(), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var json = new JsonMapper().readTree(response.body());
        assertEquals(java.util.Set.of("tenantId", "capabilityId", "enterpriseFunction", "grantedAt"), json.propertyNames());
        assertEquals(expected.toString(), json.get("tenantId").asString());
        assertEquals("quality-check", json.get("capabilityId").asString());
        assertEquals("quality-check", json.get("enterpriseFunction").asString());
        java.time.Instant.parse(json.get("grantedAt").asString());
        assertFalse(response.body().contains((expected.equals(tenant) ? other : tenant).toString()));
    }

    private int count() { return db.queryForObject("SELECT count(*) FROM qo_capability_tenant_grant", Integer.class); }
    private String snapshot(UUID id) {
        return db.queryForObject("SELECT row_to_json(g)::text FROM qo_capability_tenant_grant g WHERE tenant_id=?", String.class, id);
    }

    private String cookie() { return "DREAMCORE_AGENT=" + sessionToken; }

    private void assertError(HttpResponse<String> response, int status, String code, String message) throws Exception {
        assertEquals(status, response.statusCode(), response.body());
        assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("application/json"));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var error = new JsonMapper().readTree(response.body());
        assertEquals(4, error.size());
        assertEquals("1.0", error.get("contractVersion").asString());
        assertEquals(code, error.get("code").asString());
        assertEquals(message, error.get("message").asString());
        assertFalse(error.get("retryable").asBoolean());
    }

    private HttpResponse<String> browserSend(HttpClient browser, String method, String path, String body, String csrf) throws Exception {
        return send(browser, method, path, body, null, csrf);
    }

    private HttpResponse<String> send(String method, String path, String body, String cookie, String csrf) throws Exception {
        return send(http, method, path, body, cookie, csrf);
    }

    private HttpResponse<String> send(HttpClient client, String method, String path, String body, String cookie, String csrf) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (cookie != null) request.header("Cookie", cookie);
        if (csrf != null) request.header("X-CSRF-TOKEN", csrf);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
