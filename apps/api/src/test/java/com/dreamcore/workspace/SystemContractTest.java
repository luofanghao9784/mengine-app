package com.dreamcore.workspace;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "dreamcore.engine.timeout-ms=500")
class SystemContractTest {
    private static final String VALID = """
        {"contractVersion":"1.0","engineVersion":"0.1.0","runtimeMode":"contract-only","capabilities":[]}
        """;
    private static final AtomicReference<String> body = new AtomicReference<>(VALID);
    private static final AtomicInteger upstreamStatus = new AtomicInteger(200);
    private static final AtomicInteger delay = new AtomicInteger();
    private static final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private static final HttpServer engine = startEngine();
    private static final HttpClient http = HttpClient.newHttpClient();
    @LocalServerPort int port;

    static HttpServer startEngine() {
        try {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.setExecutor(executor);
            server.createContext("/internal/v1/capabilities", exchange -> {
                try {
                    Thread.sleep(delay.get());
                    byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(upstreamStatus.get(), bytes.length);
                    exchange.getResponseBody().write(bytes);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                } finally { exchange.close(); }
            });
            server.start();
            return server;
        } catch (Exception failure) { throw new ExceptionInInitializerError(failure); }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("dreamcore.engine.base-url", () -> "http://127.0.0.1:" + engine.getAddress().getPort());
    }

    @BeforeEach void reset() { body.set(VALID); upstreamStatus.set(200); delay.set(0); }
    @AfterAll static void stop() { engine.stop(0); executor.shutdownNow(); }

    HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test void advertisesAgentConfigurationWithoutClaimingCloudValidation() throws Exception {
        body.set("{\"contractVersion\":\"1.0\",\"engineVersion\":\"0.3.0\",\"runtimeMode\":\"agent-verification\",\"capabilities\":[\"source-lookup\",\"agent-task\"]}");
        var response=get("/api/v1/system/info");assertEquals(200,response.statusCode());assertTrue(response.body().contains("\"harness\":\"verification\""));
        body.set(body.get().replace("agent-verification","agent-live"));response=get("/api/v1/system/info");assertEquals(200,response.statusCode());assertTrue(response.body().contains("\"harness\":\"configured\""));
    }
    @Test void exposesOnlyRealFoundationStatus() throws Exception {
        var response = get("/api/v1/system/info");
        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"dataSource\":\"live\""));
        assertTrue(response.body().contains("\"runtimeMode\":\"contract-only\""));
        assertTrue(response.body().contains("\"harness\":\"not-configured\""));
        assertEquals("no-store", response.headers().firstValue("cache-control").orElseThrow());
        assertEquals(200, get("/actuator/health").statusCode());
        assertEquals(401, get("/actuator/env").statusCode());
        assertEquals(401, get("/api/v1/materials").statusCode());
    }

    @Test void rejectsNewerEngineAndMissingCapabilities() throws Exception {
        for (String value : new String[]{VALID.replace("1.0", "2.0"), "{}", "not-json", VALID.replace("[]", "[\"execute\"]")}) {
            body.set(value);
            var response = get("/api/v1/system/info");
            assertEquals(502, response.statusCode(), response.body());
            assertTrue(response.body().contains("ENGINE_INCOMPATIBLE"));
        }
    }

    @Test void upstreamErrorIsExplicitAndDoesNotLeakBody() throws Exception {
        upstreamStatus.set(500);
        body.set("internal-secret-details");
        var response = get("/api/v1/system/info");
        assertEquals(503, response.statusCode());
        assertTrue(response.body().contains("ENGINE_UNAVAILABLE"));
        assertFalse(response.body().contains("internal-secret-details"));
        assertEquals(200, get("/actuator/health").statusCode());
    }

    @Test void timeoutIsBoundedAndEngineCanRecover() throws Exception {
        delay.set(1500);
        long started = System.nanoTime();
        assertEquals(503, get("/api/v1/system/info").statusCode());
        assertTrue((System.nanoTime() - started) / 1_000_000 < 1300);
        delay.set(0);
        assertEquals(200, get("/api/v1/system/info").statusCode());
    }
}
