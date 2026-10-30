package com.dreamcore.workspace;

import com.dreamcore.workspace.capability.adapter.GrantCatalogAdapter;
import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "dreamcore.auth.ip-attempts=1000")
class OpenedCapabilitiesIntegrationTest {
    static final String PATH = "/api/tenant-admin/v1/opened-capabilities";
    static final String PASSWORD = "synthetic-only-ct039";
    static final JsonMapper JSON = new JsonMapper();
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) { IsolatedTestDatabase.register(registry); }
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired CapabilityCatalogPort production;
    @Autowired org.springframework.context.ApplicationContext context;
    UUID tenantA, tenantB, actor;
    Client customer;

    @BeforeEach void fixture() throws Exception {
        db.update("DELETE FROM qo_capability_tenant_grant");
        db.update("DELETE FROM qo_capability");
        db.update("INSERT INTO qo_capability(capability_id,name,enterprise_function) VALUES ('quality-check','合成登记质量检查','quality-check'), ('table-compare','合成登记表格对比','table-compare')");
        tenantA = tenant("合成企业甲"); tenantB = tenant("合成企业乙独有名称");
        actor = UUID.randomUUID();
        String email = actor + "@example.test";
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",
                actor, email, "合成员工", passwords.encode(PASSWORD));
        member(tenantA, "ACTIVE");
        customer = new Client();
        customer.login(email);
    }
    UUID tenant(String name) {
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name,status) VALUES (?,?,'ACTIVE')", id, name);
        return id;
    }
    void member(UUID tenant, String status) {
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,'MEMBER',?)", tenant, actor, status);
    }
    void grant(UUID tenant, String function) {
        db.update("INSERT INTO qo_capability_tenant_grant(tenant_id,enterprise_function,capability_id) VALUES (?,?,?)",
                tenant, function, function);
    }
    void assertQuality(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        assertEquals(JSON.readTree("{\"items\":[{\"enterpriseFunction\":\"quality-check\",\"displayName\":\"质量检查\"}]}"), JSON.readTree(response.body()));
        assertPrivate(response);
    }
    void assertEmpty(HttpResponse<String> response) {
        assertEquals(200, response.statusCode(), response.body());
        assertEquals(JSON.readTree("{\"items\":[]}"), JSON.readTree(response.body()));
        assertPrivate(response);
    }
    @Test void registrationAloneIsEmptyThenGrantMakesQualityVisible() throws Exception {
        assertEmpty(customer.get(PATH, null));
        grant(tenantA, "quality-check");
        assertQuality(customer.get(PATH, null));
    }
    @Test void realGrantsRemainIsolatedInBothDirections() throws Exception {
        grant(tenantA, "quality-check");
        grant(tenantB, "table-compare");
        assertQuality(customer.get(PATH, null));
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE account_id=?", actor);
        member(tenantB, "ACTIVE");
        var response = customer.get(PATH, null);
        assertEquals(200, response.statusCode(), response.body());
        assertEquals(JSON.readTree("{\"items\":[{\"enterpriseFunction\":\"table-compare\",\"displayName\":\"表格对比\"}]}"), JSON.readTree(response.body()));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        for (String forbidden : List.of("quality-check", "质量检查", tenantA.toString(), "合成企业甲", "tenantId", "capabilityId", "grantedAt", "Grant")) {
            assertFalse(response.body().contains(forbidden), response.body());
        }
    }
    @Test void contextHasExactlyOneProductionCatalog() {
        assertEquals(GrantCatalogAdapter.class, production.getClass());
        assertEquals(1, context.getBeansOfType(CapabilityCatalogPort.class).size());
    }
    @Test void unknownCodesAreSkippedAndNamesComeOnlyFromEnum() {
        // V193 rejects unknown codes today; exercise forward-compatible reads without changing its constraint.
        JdbcTemplate futureData = org.mockito.Mockito.mock(JdbcTemplate.class);
        org.mockito.Mockito.when(futureData.queryForList(
                "SELECT enterprise_function FROM qo_capability_tenant_grant WHERE tenant_id = ?",
                String.class, tenantA)).thenReturn(List.of("unknown", "quality-check", "QUALITY_CHECK", "table-compare"));
        assertEquals(List.of(CapabilityCatalogPort.EnterpriseFunction.QUALITY_CHECK,
                CapabilityCatalogPort.EnterpriseFunction.TABLE_COMPARE),
                new GrantCatalogAdapter(futureData).listOpenedCapabilities(tenantA));
    }
    @Test void agentCanOpenButCustomerCannotSelfGrant() throws Exception {
        String grantsPath = "/api/agent-admin/v1/tenants/" + tenantA + "/grants";
        String body = "{\"capabilityId\":\"quality-check\",\"enterpriseFunction\":\"quality-check\"}";
        assertEmpty(customer.get(PATH, null));
        String customerCsrf = JSON.readTree(customer.get("/api/v1/auth/csrf", null).body()).get("token").asString();
        assertEquals(401, customer.post(grantsPath, body, customerCsrf).statusCode());
        assertEquals(0, db.queryForObject("SELECT count(*) FROM qo_capability_tenant_grant WHERE tenant_id=?", Integer.class, tenantA));
        UUID agentId = UUID.randomUUID();
        String login = agentId + "@example.test";
        String hash = passwords.encode(PASSWORD);
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)", agentId, login, "合成第四端账号", hash);
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'AGENT_ADMIN')", agentId);
        db.update("INSERT INTO agent_platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)", agentId, login, hash);
        Client agent = new Client();
        agent.login(login, "/api/agent-admin/v1/auth", "username");
        assertTrue(agent.cookies.getCookieStore().getCookies().stream().anyMatch(c -> c.getName().equals("DREAMCORE_AGENT")));
        assertFalse(agent.cookies.getCookieStore().getCookies().stream().anyMatch(c -> c.getName().equals("DREAMCORE_SESSION")));
        String csrf = JSON.readTree(agent.get("/api/agent-admin/v1/auth/csrf", null).body()).get("token").asString();
        var opened = agent.post(grantsPath, body, csrf);
        assertEquals(201, opened.statusCode(), opened.body());
        assertQuality(customer.get(PATH, null));
    }
    @Test void callerCannotSelectTenantInQueryBodyOrPath() throws Exception {
        grant(tenantA, "quality-check");
        grant(tenantB, "table-compare");
        for (String path : List.of(PATH + "?tenantId=" + tenantB, PATH + "/" + tenantB, PATH + "?other=value")) {
            error(customer.get(path, null), 400, "有无法识别的字段，请检查后再提交");
        }
        for (String body : List.of("{\"tenantId\":\"" + tenantB + "\"}", "{\"tenantId\":null}", "{broken")) {
            error(customer.get(PATH, body), 400, "有无法识别的字段，请检查后再提交");
        }
    }
    @Test void missingAmbiguousInactiveMembershipsFailClosed() throws Exception {
        member(tenantB, "ACTIVE");
        error(customer.get(PATH, null), 404, "暂时不能查看已开通功能");
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?", tenantB);
        error(customer.get(PATH, null), 404, "暂时不能查看已开通功能");
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE account_id=?", actor);
        error(customer.get(PATH, null), 404, "暂时不能查看已开通功能");
        db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE account_id=? AND tenant_id=?", actor, tenantA);
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?", tenantA);
        error(customer.get(PATH, null), 404, "暂时不能查看已开通功能");
    }
    @Test void inactiveOtherMembershipDoesNotPreventUniqueActiveEnterprise() throws Exception {
        member(tenantB, "DISABLED");
        assertEquals(200, customer.get(PATH, null).statusCode());
    }
    @Test void anonymousAndForeignCookieNamesAre401() throws Exception {
        error(new Client().get(PATH, null), 401, "请求未获授权。");
        String token = customer.cookies.getCookieStore().getCookies().stream()
                .filter(c -> c.getName().equals("DREAMCORE_SESSION")).findFirst().orElseThrow().getValue();
        for (String name : List.of("DREAMCORE_AGENT", "DREAMCORE_PLATFORM")) {
            var request = HttpRequest.newBuilder(URI.create(url(PATH))).header("Cookie", name + "=" + token).GET().build();
            error(HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()), 401, "请求未获授权。");
        }
    }
    @Test void realAgentAndPlatformSessionsCannotAuthenticateCustomerRead() throws Exception {
        for (String realm : List.of("agent", "platform")) {
            UUID id = UUID.randomUUID();
            String login = id + "@example.test";
            String hash = passwords.encode(PASSWORD);
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)", id, login, "合成后台账号", hash);
            db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,?)", id, realm.equals("agent") ? "AGENT_ADMIN" : "PLATFORM_ADMIN");
            if (realm.equals("agent")) {
                db.update("INSERT INTO agent_platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)", id, login, hash);
            } else {
                db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)", id, login, hash);
            }
            Client foreign = new Client();
            foreign.login(login, "/api/" + realm + "-admin/v1/auth", "username");
            error(foreign.get(PATH, null), 401, "请求未获授权。");
        }
    }

    @Test void qualityopsImportsOnlyReadPortAndContractIsPinned() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (!Files.isDirectory(root.resolve("contracts"))) root = root.getParent();
        try (var files = Files.walk(root.resolve("apps/api/src/main/java/com/dreamcore/workspace/qualityops"))) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file);
                assertFalse(source.contains("qo_capability_tenant_grant"));
                assertFalse(source.matches("(?s).*\\b(JdbcTemplate|java\\.sql|SELECT|INSERT|UPDATE|DELETE)\\b.*"));
                assertFalse(source.matches("(?s).*import\\s+(static\\s+)?com\\.dreamcore\\.workspace\\.(agentregistry|agentadmin)\\..*"));
            }
        }
        var contract = JSON.readTree(Files.readString(root.resolve("contracts/public-api/opened-capabilities.openapi.json")));
        var operation = contract.get("paths").get(PATH).get("get");
        assertEquals("listOpenedCapabilities", operation.get("operationId").asString());
        assertNull(operation.get("parameters")); assertNull(operation.get("requestBody"));
        var schemas = contract.get("components").get("schemas");
        assertFalse(schemas.get("OpenedCapability").get("additionalProperties").asBoolean());
        assertEquals(2, schemas.get("OpenedCapability").get("properties").size());
        assertEquals(5, schemas.get("OpenedCapability").get("properties").get("enterpriseFunction").get("enum").size());
        assertEquals("./error.schema.json", operation.get("responses").get("404").get("content").get("application/json").get("schema").get("$ref").asString());
    }
    void error(HttpResponse<String> response, int status, String message) {
        assertEquals(status, response.statusCode(), response.body());
        var body = JSON.readTree(response.body());
        assertEquals(4, body.size());
        assertEquals(message, body.get("message").asString());
        assertEquals("1.0", body.get("contractVersion").asString());
        assertFalse(body.get("retryable").asBoolean());
        assertNull(body.get("items"));
        assertPrivate(response);
    }
    void assertPrivate(HttpResponse<String> response) {
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        for (String forbidden : List.of("合成企业", tenantB.toString(), "table-compare", "表格对比", "tenantId", "capabilityId", "moduleVersionId", "isDefault", "grantedAt", "Grant")) {
            assertFalse(response.body().contains(forbidden), response.body());
        }
    }
    String url(String path) { return "http://127.0.0.1:" + port + path; }
    final class Client {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();
        HttpResponse<String> get(String path, String body) throws Exception {
            return http.send(HttpRequest.newBuilder(URI.create(url(path))).header("Content-Type", "application/json")
                    .method("GET", body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        }
        HttpResponse<String> post(String path, String body, String csrf) throws Exception {
            return http.send(HttpRequest.newBuilder(URI.create(url(path)))
                    .header("Content-Type", "application/json").header("X-CSRF-TOKEN", csrf)
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        }
        void login(String email) throws Exception { login(email, "/api/v1/auth", "email"); }
        void login(String email, String auth, String field) throws Exception {
            var csrf = JSON.readTree(get(auth + "/csrf", null).body()).get("token").asString();
            var request = HttpRequest.newBuilder(URI.create(url(auth + "/login")))
                    .header("Content-Type", "application/json").header("X-CSRF-TOKEN", csrf)
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(Map.of(field, email, "password", PASSWORD)))).build();
            var response = http.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode(), response.body());
        }
    }
}
