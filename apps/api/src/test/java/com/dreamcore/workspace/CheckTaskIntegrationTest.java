package com.dreamcore.workspace;

import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
import com.dreamcore.workspace.qualityops.CheckTaskService;
import com.dreamcore.workspace.qualityops.RuleQualityCheckEngine;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"dreamcore.auth.ip-attempts=1000", "dreamcore.quality-check.timeout-ms=1000"})
class CheckTaskIntegrationTest {
    static final String PATH = "/api/tenant-admin/v1/quality-ops/check-tasks";
    static final JsonMapper JSON = new JsonMapper();
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) { IsolatedTestDatabase.register(registry); }
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @MockitoSpyBean CapabilityCatalogPort catalog;
    @MockitoSpyBean RuleQualityCheckEngine engine;
    @MockitoSpyBean CheckTaskService tasks;
    static final String PASSWORD = "synthetic-only-ct043";
    UUID tenantA, tenantB, actor;
    Client customer;

    @BeforeEach void fixture() throws Exception {
        db.update("DELETE FROM qo_check_task");
        db.update("DELETE FROM qo_capability_tenant_grant");
        db.update("DELETE FROM qo_capability");
        db.update("INSERT INTO qo_capability(capability_id,name,enterprise_function) VALUES ('quality-check','合成质量检查','quality-check'), ('table-compare','合成表格对比','table-compare')");
        tenantA = tenant(); tenantB = tenant();
        actor = UUID.randomUUID();
        String email = actor + "@example.test";
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",
                actor, email, "合成员工", passwords.encode(PASSWORD));
        member(tenantA);
        customer = new Client();
        customer.login(email);
    }

    UUID tenant() {
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name,status) VALUES (?,?,'ACTIVE')", id, "合成企业");
        return id;
    }
    void member(UUID tenant) {
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,'MEMBER','ACTIVE')", tenant, actor);
    }
    void grant(UUID tenant) {
        db.update("INSERT INTO qo_capability_tenant_grant(tenant_id,enterprise_function,capability_id) VALUES (?,'quality-check','quality-check')", tenant);
    }
    void noRows() { assertEquals(0, db.queryForObject("SELECT count(*) FROM qo_check_task", Integer.class)); }
    String material(String text) { return JSON.writeValueAsString(Map.of("materialText", text)); }
    void error(HttpResponse<String> response, int status, String code, String message) {
        assertEquals(status, response.statusCode(), response.body());
        var body = JSON.readTree(response.body());
        assertEquals(4, body.size());
        assertEquals("1.0", body.get("contractVersion").asString());
        assertEquals(code, body.get("code").asString());
        assertEquals(message, body.get("message").asString());
        assertEquals(status >= 500, body.get("retryable").asBoolean());
        assertFalse(response.body().contains("verdict"), response.body());
        assertFalse(response.body().contains("result"), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        noRows();
    }

    @Test void anonymousWithRealCsrfMustBe401() throws Exception {
        var cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        var http = HttpClient.newBuilder().cookieHandler(cookies).build();
        String base = "http://127.0.0.1:" + port;
        var csrf = http.send(HttpRequest.newBuilder(URI.create(base + "/api/v1/auth/csrf")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, csrf.statusCode(), csrf.body());
        assertTrue(cookies.getCookieStore().getCookies().stream().anyMatch(c -> c.getName().equals("DREAMCORE_SESSION")));
        var response = http.send(HttpRequest.newBuilder(URI.create(base + PATH))
                .header("Content-Type", "application/json")
                .header("X-CSRF-TOKEN", JSON.readTree(csrf.body()).get("token").asString())
                .POST(HttpRequest.BodyPublishers.ofString("{\"materialText\":\"问题：尺寸超差\"}")).build(),
                HttpResponse.BodyHandlers.ofString());
        System.out.println("CT-043-A anonymous valid CSRF: status=" + response.statusCode() + " body=" + response.body());
        assertEquals(401, response.statusCode(), response.body());
        assertEquals("AUTHENTICATION_REQUIRED", JSON.readTree(response.body()).get("code").asString());
        assertFalse(response.body().contains("verdict"));
        assertFalse(response.body().contains("result"));
        noRows();
        verifyNoInteractions(tasks, catalog, engine);
    }

    @Test void anonymousWithoutCsrfIs401Or403AndNeverWrites() throws Exception {
        var response = new Client().post(material("问题：尺寸超差"), null);
        assertTrue(response.statusCode() == 401 || response.statusCode() == 403, response.body());
        System.out.println("CT-043-A anonymous no CSRF: status=" + response.statusCode() + " body=" + response.body());
        error(response, response.statusCode(), response.statusCode() == 401 ? "AUTHENTICATION_REQUIRED" : "ACCESS_DENIED", "请求未获授权。");
        verifyNoInteractions(tasks, catalog, engine);
    }

    @Test void authenticatedWithoutCsrfIsForbidden() throws Exception {
        grant(tenantA);
        error(customer.post(material("问题：尺寸超差"), null), 403, "ACCESS_DENIED", "请求未获授权。");
        verifyNoInteractions(tasks, catalog, engine);
    }

    @Test void unopenedOrOtherCapabilityNeverRunsEngine() throws Exception {
        error(customer.submit(material("问题：尺寸超差")), 403, "CAPABILITY_NOT_OPENED", "贵企业还没开通「质量检查」，请联系平台管理员开通");
        db.update("INSERT INTO qo_capability_tenant_grant(tenant_id,enterprise_function,capability_id) VALUES (?,'table-compare','table-compare')", tenantA);
        error(customer.submit(material("问题：尺寸超差")), 403, "CAPABILITY_NOT_OPENED", "贵企业还没开通「质量检查」，请联系平台管理员开通");
        verify(catalog, times(2)).listOpenedCapabilities(tenantA);
        verifyNoInteractions(engine);
    }

    @ParameterizedTest
    @ValueSource(strings = {"问题：尺寸超差", "问题:尺寸超差"})
    void bothColonsProduceExactIssueAndPersistSessionOwner(String text) throws Exception {
        grant(tenantA);
        var response = customer.submit(JSON.writeValueAsString(Map.of("materialText", "  " + text + "  ", "title", "  合成记录  ")));
        var result = completed(response, "ISSUES_FOUND");
        assertEquals(JSON.readTree("[{\"message\":\"尺寸超差\"}]"), result.get("issues"));
        var row = db.queryForMap("SELECT * FROM qo_check_task");
        assertEquals(tenantA, row.get("tenant_id"));
        assertEquals(actor, row.get("created_by"));
        assertEquals("合成记录", row.get("title"));
        assertEquals(text, row.get("material_text"));
        assertEquals("COMPLETED", row.get("status"));
        assertEquals(JSON.readTree(response.body()).get("taskId").asString(), row.get("id").toString());
        assertEquals(result, JSON.readTree(row.get("result_json").toString()));
        assertNotNull(row.get("created_at"));
        assertEquals(8, row.size());
        verify(catalog).listOpenedCapabilities(tenantA);
        verify(engine).check(text);
    }

    @ParameterizedTest
    @ValueSource(strings = {"本批记录完整。", "问题：", "问题:", "问题：   ", "问题:   "})
    void emptyIssuesAndOrdinaryMaterialHaveNoIssues(String text) throws Exception {
        grant(tenantA);
        var result = completed(customer.submit(material(text)), "NO_ISSUES");
        assertEquals(0, result.get("issues").size());
        assertNull(db.queryForMap("SELECT title FROM qo_check_task").get("title"));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM qo_check_task", Integer.class));
    }

    @Test void issueMessagesKeepOrderAndOriginalTextAfterTrim() throws Exception {
        grant(tenantA);
        String text = "普通说明问题：不触发\n  问题：  尺寸超差，保留标点  \n问题: 原文:不得截断\n问题：   ";
        var result = completed(customer.submit(JSON.writeValueAsString(Map.of("materialText", text, "title", "   "))), "ISSUES_FOUND");
        assertEquals(JSON.readTree("[{\"message\":\"尺寸超差，保留标点\"},{\"message\":\"原文:不得截断\"}]"), result.get("issues"));
        assertNull(db.queryForMap("SELECT title FROM qo_check_task").get("title"));
    }

    @Test void everySubmissionRechecksGrantAndTenantBCannotUseTenantAGrant() throws Exception {
        grant(tenantA);
        completed(customer.submit(material("本批记录完整。")), "NO_ISSUES");
        db.update("DELETE FROM qo_capability_tenant_grant WHERE tenant_id=?", tenantA);
        db.update("DELETE FROM qo_check_task");
        error(customer.submit(material("问题：尺寸超差")), 403, "CAPABILITY_NOT_OPENED", "贵企业还没开通「质量检查」，请联系平台管理员开通");
        verify(catalog, times(2)).listOpenedCapabilities(tenantA);
        grant(tenantA);
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE account_id=?", actor);
        member(tenantB);
        error(customer.submit(material("问题：尺寸超差")), 403, "CAPABILITY_NOT_OPENED", "贵企业还没开通「质量检查」，请联系平台管理员开通");
        verify(catalog).listOpenedCapabilities(tenantB);
    }

    @Test void multipleEnterprisesAre404WithoutGuessing() throws Exception {
        grant(tenantA); member(tenantB);
        error(customer.submit(material("问题：尺寸超差")), 404, "OPENED_CAPABILITIES_UNAVAILABLE", "暂时不能查看已开通功能");
        verifyNoInteractions(catalog, engine);
    }

    @Test void noMembershipOrInactiveEnterpriseIs404() throws Exception {
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?", tenantA);
        error(customer.submit(material("正常材料")), 404, "OPENED_CAPABILITIES_UNAVAILABLE", "暂时不能查看已开通功能");
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE account_id=?", actor);
        error(customer.submit(material("正常材料")), 404, "OPENED_CAPABILITIES_UNAVAILABLE", "暂时不能查看已开通功能");
        verifyNoInteractions(catalog, engine);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{", "{\"materialText\":null}", "{\"materialText\":123}",
            "{\"materialText\":\"   \"}", "{\"materialText\":\"正常\",\"title\":null}",
            "{\"materialText\":\"正常\",\"title\":false}", "{\"materialText\":\"正常\",\"unknown\":true}",
            "{\"materialText\":\"正常\",\"tenantId\":\"caller-tenant\"}",
            "{\"materialText\":\"正常\",\"inputVersionId\":\"v1\"}",
            "{\"materialText\":\"正常\",\"configVersionId\":\"v1\"}",
            "{\"materialText\":\"正常\",\"executionMode\":\"sync\"}"})
    void invalidBodyIsAlways400WithoutConclusion(String body) throws Exception {
        grant(tenantA);
        error(customer.submit(body), 400, "INVALID_REQUEST", "内容不符合要求");
        verifyNoInteractions(catalog, engine);
    }

    @Test void trimmedLimitsAreEnforced() throws Exception {
        grant(tenantA);
        error(customer.submit(material("文".repeat(20001))), 400, "INVALID_REQUEST", "内容不符合要求");
        error(customer.submit(JSON.writeValueAsString(Map.of("materialText", "正常", "title", "题".repeat(201)))), 400, "INVALID_REQUEST", "内容不符合要求");
        completed(customer.submit(JSON.writeValueAsString(Map.of("materialText", "  " + "文".repeat(20000) + "  ", "title", "  " + "题".repeat(200) + "  "))), "NO_ISSUES");
    }

    @Test void portFailureIs503WithoutWriteOrEngineCall() throws Exception {
        doThrow(new IllegalStateException("synthetic catalog failure")).when(catalog).listOpenedCapabilities(tenantA);
        unavailable(customer.submit(material("问题：尺寸超差")));
        verifyNoInteractions(engine);
    }

    @Test void engineFailureIs503WithoutWrite() throws Exception {
        grant(tenantA);
        doThrow(new IllegalStateException("synthetic engine failure")).when(engine).check(anyString());
        unavailable(customer.submit(material("问题：尺寸超差")));
    }

    @Test void portTimeoutCannotWriteEvenWhenLateWorkerIgnoresInterrupt() throws Exception {
        var release = new CountDownLatch(1);
        var finished = new CountDownLatch(1);
        doAnswer(call -> {
            awaitRelease(release);
            finished.countDown();
            return List.of(CapabilityCatalogPort.EnterpriseFunction.QUALITY_CHECK);
        }).when(catalog).listOpenedCapabilities(tenantA);
        try {
            assertTimeout(Duration.ofSeconds(5), () -> unavailable(customer.submit(material("问题：尺寸超差"))));
        } finally { release.countDown(); }
        assertTrue(finished.await(3, TimeUnit.SECONDS));
        noRows();
    }

    @Test void engineTimeoutCannotWriteEvenWhenLateWorkerIgnoresInterrupt() throws Exception {
        grant(tenantA);
        var release = new CountDownLatch(1);
        var finished = new CountDownLatch(1);
        doAnswer(call -> {
            awaitRelease(release);
            var result = call.callRealMethod();
            finished.countDown();
            return result;
        }).when(engine).check(anyString());
        try {
            assertTimeout(Duration.ofSeconds(5), () -> unavailable(customer.submit(material("问题：尺寸超差"))));
        } finally { release.countDown(); }
        assertTrue(finished.await(3, TimeUnit.SECONDS));
        noRows();
    }

    static void awaitRelease(CountDownLatch release) {
        boolean released = false;
        while (!released) {
            try { release.await(); released = true; }
            catch (InterruptedException ignored) { /* Simulate a dependency that completes after cancellation. */ }
        }
    }
    void unavailable(HttpResponse<String> response) {
        error(response, 503, "QUALITY_CHECK_UNAVAILABLE", "质量检查暂时不可用，请稍后再试");
    }
    tools.jackson.databind.JsonNode completed(HttpResponse<String> response, String verdict) {
        assertEquals(201, response.statusCode(), response.body());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        var body = JSON.readTree(response.body());
        assertEquals(3, body.size());
        assertNotNull(UUID.fromString(body.get("taskId").asString()));
        assertEquals("COMPLETED", body.get("status").asString());
        var result = body.get("result");
        assertEquals(2, result.size());
        assertEquals(verdict, result.get("verdict").asString());
        assertTrue(result.get("issues").isArray());
        assertEquals(verdict.equals("NO_ISSUES"), result.get("issues").isEmpty());
        assertFalse(response.body().contains("检查通过"));
        return result;
    }

    final class Client {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build();
        String url(String path) { return "http://127.0.0.1:" + port + path; }
        HttpResponse<String> get(String path) throws Exception {
            return http.send(HttpRequest.newBuilder(URI.create(url(path))).GET().build(), HttpResponse.BodyHandlers.ofString());
        }
        String csrf() throws Exception {
            var response = get("/api/v1/auth/csrf");
            assertEquals(200, response.statusCode(), response.body());
            return JSON.readTree(response.body()).get("token").asString();
        }
        HttpResponse<String> post(String body, String csrf) throws Exception { return post(PATH, body, csrf); }
        HttpResponse<String> post(String path, String body, String csrf) throws Exception {
            var request = HttpRequest.newBuilder(URI.create(url(path))).timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json");
            if (csrf != null) request.header("X-CSRF-TOKEN", csrf);
            return http.send(request.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        }
        HttpResponse<String> submit(String body) throws Exception { return post(body, csrf()); }
        void login(String email) throws Exception {
            var response = post("/api/v1/auth/login", JSON.writeValueAsString(Map.of("email", email, "password", PASSWORD)), csrf());
            assertEquals(200, response.statusCode(), response.body());
        }
    }
}
