package com.dreamcore.workspace.engine;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.json.JsonMapper;

/** Only the platform-owned wire contract crosses this boundary; no engine SDK types. */
@Component
public class EngineGateway {
    public record Capabilities(String contractVersion, String engineVersion,
                               String runtimeMode, List<String> capabilities) {}

    public static class Unavailable extends RuntimeException {}
    public static class Incompatible extends RuntimeException {}

    private final RestClient client;
    private final JsonMapper json = JsonMapper.builder().build();

    public EngineGateway(@Value("${dreamcore.engine.base-url}") String baseUrl,
                         @Value("${dreamcore.engine.timeout-ms}") long timeoutMs) {
        URI uri = URI.create(baseUrl);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))
                || timeoutMs < 1 || timeoutMs > 30_000) {
            throw new IllegalArgumentException("Invalid engine connection configuration");
        }
        Duration timeout = Duration.ofMillis(timeoutMs);
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build());
        factory.setReadTimeout(timeout);
        client = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    public Capabilities capabilities() {
        String body;
        try {
            body = client.get().uri("/internal/v1/capabilities").retrieve().body(String.class);
        } catch (RestClientException failure) {
            throw new Unavailable();
        }
        Capabilities response;
        try {
            response = json.readValue(body, Capabilities.class);
        } catch (RuntimeException failure) {
            throw new Incompatible();
        }
        if (response == null || !"1.0".equals(response.contractVersion())
                || response.engineVersion() == null || response.engineVersion().isBlank()
                || response.capabilities() == null
                || !("contract-only".equals(response.runtimeMode()) && response.capabilities().isEmpty()
                     || "local-retrieval".equals(response.runtimeMode()) && response.capabilities().equals(List.of("source-lookup"))
                     || ("agent-verification".equals(response.runtimeMode()) || "agent-live".equals(response.runtimeMode())) && response.capabilities().equals(List.of("source-lookup","agent-task")))) {
            throw new Incompatible();
        }
        return response;
    }
}
