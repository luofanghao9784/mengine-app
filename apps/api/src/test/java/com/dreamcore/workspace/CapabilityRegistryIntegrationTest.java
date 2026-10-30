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
class CapabilityRegistryIntegrationTest {
    private static final String PATH = "/api/agent-admin/v1/capabilities";
    private static final String BODY = "{\"capabilityId\":\"quality-check\",\"name\":\"质量检查\",\"enterpriseFunction\":\"quality-check\"}";
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

    // Same account/role and real CSRF -> login flow as AgentAdminIdentityIntegrationTest.
    @BeforeEach void resetRegistry() { db.update("DELETE FROM qo_capability"); }

    @BeforeEach void fixture() throws Exception {
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

    @Test void unauthenticatedWriteReturnsChinese401BeforeBodyValidation() throws Exception {
        for (String body : new String[]{BODY, "{\"unknown\":true}", "{\"enterpriseFunction\":\"quality-check\"}", "{"}) {
            assertError(send("POST", PATH, body, null, null), 401, "AUTHENTICATION_REQUIRED", "还没有登录，请先登录后再试");
        }
        assertEquals(0, rowCount());
    }

    @Test void sessionWithoutOrWithWrongCsrfReturnsChinese403() throws Exception {
        for (String token : new String[]{null, "wrong", IdentityService.hash("another-session")}) {
            assertError(send("POST", PATH, BODY, cookie(), token), 403, "ACCESS_DENIED", "登录校验未通过，请刷新页面后再试");
        }
        assertEquals(403, send("POST", PATH, "{\"unknown\":true}", cookie(), null).statusCode());
        assertEquals(0, rowCount());
    }

    @Test void authenticatedControllerPersistsAndReturns201WithSessionAndCsrf() throws Exception {
        assertTrue(mappings.getHandlerMethods().values().stream().anyMatch(handler ->
                handler.getBeanType().getSimpleName().equals("CapabilityRegistryController")
                        && handler.getMethod().getName().equals("registerCapability")));
        assertCreated(BODY);
        var row = db.queryForMap("SELECT * FROM qo_capability WHERE capability_id='quality-check'");
        assertEquals("质量检查", row.get("name"));
        assertEquals("quality-check", row.get("enterprise_function"));
        assertNull(row.get("kind"));
        assertNotNull(row.get("created_at"));
        assertEquals(0, db.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='qo_capability' AND column_name='tenant_id'
                """, Integer.class));
        assertCreated("{\"capabilityId\":\"another-check\",\"name\":\"另一个检查\",\"kind\":\"quality_check\"}");
        var optional = db.queryForMap("SELECT * FROM qo_capability WHERE capability_id='another-check'");
        assertEquals("quality_check", optional.get("kind"));
        assertNull(optional.get("enterprise_function"));
        assertEquals(2, rowCount());
    }

    @Test void authenticatedUnknownFieldsReturnChinese400() throws Exception {
        assertError(send("POST", PATH, BODY.replace("}", ",\"unknown\":true}"), cookie(), csrf),
                400, "INVALID_REQUEST", "有无法识别的字段，请检查后再提交");
        assertEquals(0, rowCount());
    }

    @Test void capabilityRequiredFieldsTypesAndClosedEnumsAreValidated() throws Exception {
        for (String body : new String[]{"{}", "{\"enterpriseFunction\":\"quality-check\"}", "[]", "null",
                BODY.replace("\"质量检查\"", "42"),
                BODY.replace("\"capabilityId\":\"quality-check\"", "\"capabilityId\":\" \""), BODY.replace("质量检查", " "),
                BODY.replace("\"capabilityId\":\"quality-check\"", "\"capabilityId\":null"),
                BODY.replace("\"enterpriseFunction\":\"quality-check\"", "\"enterpriseFunction\":null"),
                BODY.replace("}", ",\"kind\":null}"), BODY.replace("\"enterpriseFunction\":\"quality-check\"", "\"enterpriseFunction\":\"unknown\""),
                BODY.replace("}", ",\"kind\":\"unknown\"}")}) {
            assertError(send("POST", PATH, body, cookie(), csrf), 400, "INVALID_REQUEST", "请按要求填写登记内容");
        }
        assertEquals(0, rowCount());
    }

    @Test void foreignCookiesAndInvalidAgentSessionsCannotAuthenticate() throws Exception {
        for (String cookie : new String[]{"DREAMCORE_PLATFORM=00000000-0000-0000-0000-0000000000aa",
                "DREAMCORE_SESSION=00000000-0000-0000-0000-0000000000aa",
                "JSESSIONID=" + sessionToken, "DREAMCORE_AGENT=invalid", "DREAMCORE_AGENT=" + "x".repeat(43)}) {
            assertError(send("POST", PATH, BODY, cookie, csrf), 401,
                    "AUTHENTICATION_REQUIRED", "还没有登录，请先登录后再试");
        }
        db.update("UPDATE agent_platform_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=?", IdentityService.hash(sessionToken));
        assertEquals(401, send("POST", PATH, BODY, cookie(), null).statusCode());
        assertEquals(0, rowCount());
    }

    @Test void csrfIsBoundToTheAuthenticatedSession() throws Exception {
        String firstCookie = cookie(), firstCsrf = csrf;
        fixture(); // A second independently logged-in AGENT_ADMIN, no session-table inserts.
        assertEquals(403, send("POST", PATH, BODY, cookie(), firstCsrf).statusCode());
        assertEquals(403, send("POST", PATH, BODY, firstCookie, csrf).statusCode());
        assertEquals(201, send("POST", PATH, BODY, firstCookie, firstCsrf).statusCode());
    }

    @Test void preLoginSessionAndRevokedRoleReturn401BeforeCsrf() throws Exception {
        var bootstrap = send("GET", AUTH + "/csrf", null, null, null);
        assertEquals(200, bootstrap.statusCode());
        String preLoginCookie = bootstrap.headers().firstValue("Set-Cookie").orElseThrow().split(";", 2)[0];
        String preLoginCsrf = new JsonMapper().readTree(bootstrap.body()).get("token").asString();
        for (String token : new String[]{null, preLoginCsrf}) {
            assertEquals(401, send("POST", PATH, BODY, preLoginCookie, token).statusCode());
        }
        db.update("DELETE FROM platform_roles WHERE account_id=? AND role='AGENT_ADMIN'", actor);
        for (String token : new String[]{null, csrf}) {
            assertEquals(401, send("POST", PATH, BODY, cookie(), token).statusCode());
        }
        assertEquals(0, rowCount());
    }

    @Test void dedicatedChainDoesNotOpenOtherMethodsOrNeighboringRoutes() throws Exception {
        assertEquals(401, send("GET", PATH, null, null, null).statusCode());
        assertEquals(401, send("POST", PATH + "/other", "{}", null, null).statusCode());
        assertEquals(403, send("POST", PATH + "/other", "{}", cookie(), null).statusCode());
        assertEquals(401, send("GET", "/api/v1/me", null, cookie(), csrf).statusCode());
        assertEquals(401, send("GET", "/api/platform-admin/v1/auth/me", null, cookie(), csrf).statusCode());
        // 同一个 HTTP 客户端先前的第四端成功请求不会认证后续匿名请求。
        assertEquals(201, send("POST", PATH, BODY, cookie(), csrf).statusCode());
        assertEquals(401, send("POST", PATH, BODY, null, csrf).statusCode());
    }

    @Test void duplicateRegistrationReturns409AndLeavesOriginalRowUnchanged() throws Exception {
        String original = BODY.replace("}", ",\"kind\":\"quality_check\"}");
        assertCreated(original);
        String before = db.queryForObject("SELECT row_to_json(c)::text FROM qo_capability c WHERE capability_id='quality-check'", String.class);
        // A different fourth-end account still shares the platform-global unique key.
        assertError(send("POST", PATH, BODY, cookie(), csrf),
                409, "CAPABILITY_ALREADY_REGISTERED", "已经登记过了，请勿重复提交");
        fixture();
        assertError(send("POST", PATH, BODY.replace("质量检查", "不能覆盖").replace("quality-check\"}", "table-compare\"}"), cookie(), csrf),
                409, "CAPABILITY_ALREADY_REGISTERED", "已经登记过了，请勿重复提交");
        assertEquals(1, rowCount());
        assertEquals(before, db.queryForObject("SELECT row_to_json(c)::text FROM qo_capability c WHERE capability_id='quality-check'", String.class));
    }

    @Test void everyDeclaredEnterpriseFunctionCanBePersisted() throws Exception {
        for (String function : new String[]{"document-parse", "table-compare", "quality-check", "semantic-annotation", "repair-suggestion"}) {
            assertCreated(BODY.replace("quality-check", function));
            assertEquals(function, db.queryForObject("SELECT enterprise_function FROM qo_capability WHERE capability_id=?", String.class, function));
        }
        assertEquals(5, rowCount());
    }

    private int rowCount() {
        return db.queryForObject("SELECT count(*) FROM qo_capability", Integer.class);
    }

    private void assertCreated(String body) throws Exception {
        var response = send("POST", PATH, body, cookie(), csrf);
        assertEquals(201, response.statusCode(), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals(new JsonMapper().readTree(body), new JsonMapper().readTree(response.body()));
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
