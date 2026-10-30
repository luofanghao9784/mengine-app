package com.dreamcore.workspace;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
    @DynamicPropertySource
    static void isolateDatabase(DynamicPropertyRegistry registry) { IsolatedTestDatabase.register(registry); }
    @LocalServerPort int port;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;
    private final HttpClient http = HttpClient.newHttpClient();

    @Test void registeredControllerReturnsHonestChinese501WithoutSessionOrCsrf() throws Exception {
        assertTrue(mappings.getHandlerMethods().values().stream().anyMatch(handler ->
                handler.getBeanType().getSimpleName().equals("CapabilityRegistryController")
                        && handler.getMethod().getName().equals("registerCapability")));
        for (String body : new String[]{"{\"enterpriseFunction\":\"quality-check\"}",
                "{\"capabilityId\":\"quality-check\",\"name\":\"质量检查\",\"kind\":\"quality_check\"}"}) {
            var response = send("POST", PATH, body);
            assertEquals(501, response.statusCode(), response.body());
            assertTrue(response.headers().firstValue("Content-Type").orElseThrow().startsWith("application/json"));
            assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
            var error = new JsonMapper().readTree(response.body());
            assertEquals(4, error.size());
            assertEquals("1.0", error.get("contractVersion").asString());
            assertEquals("CAPABILITY_REGISTRATION_NOT_IMPLEMENTED", error.get("code").asString());
            assertEquals("登记保存还在开通中，请稍后再试", error.get("message").asString());
            assertFalse(error.get("retryable").asBoolean());
        }
    }

    @Test void stubExceptionDoesNotOpenOtherMethodsOrNeighboringRoutes() throws Exception {
        assertEquals(401, send("GET", PATH, null).statusCode());
        assertEquals(403, send("POST", PATH + "/other", "{}").statusCode());
        assertEquals(401, send("GET", "/api/v1/me", null).statusCode());
    }

    private HttpResponse<String> send(String method, String path, String body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
