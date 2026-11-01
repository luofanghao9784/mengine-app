package com.dreamcore.workspace;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class QualityOpsBoundaryArchTest {
    Path root() {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.isDirectory(root.resolve("contracts"))) root = root.getParent();
        return java.util.Objects.requireNonNull(root);
    }

    @Test void qualityopsDoesNotImportAdministrationOrReadCapabilityTables() throws Exception {
        try (var files = Files.walk(root().resolve("apps/api/src/main/java/com/dreamcore/workspace/qualityops"))) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file);
                assertFalse(source.matches("(?s).*\\bimport\\s+(?:static\\s+)?com\\.dreamcore\\.workspace\\.agentadmin\\..*"), file.toString());
                assertFalse(source.contains("qo_capability"), file.toString());
                assertFalse(source.contains("qo_capability_tenant_grant"), file.toString());
            }
        }
    }

    @Test void submissionContractHasOnlyTextAndCompleteSynchronousResult() throws Exception {
        var contract = new JsonMapper().readTree(Files.readString(root().resolve("contracts/public-api/check-run-log.openapi.json")));
        var operation = contract.get("paths").get("/api/tenant-admin/v1/quality-ops/check-tasks").get("post");
        assertEquals("createCheckTask", operation.get("operationId").asString());
        assertEquals("#/components/schemas/CheckTaskCreate", operation.get("requestBody").get("content").get("application/json").get("schema").get("$ref").asString());
        var request = contract.get("components").get("schemas").get("CheckTaskCreate");
        assertFalse(request.get("additionalProperties").asBoolean());
        assertEquals(Set.of("materialText", "title"), Set.copyOf(request.get("properties").propertyNames()));
        assertEquals("[\"materialText\"]", request.get("required").toString());
        assertEquals(1, request.get("properties").get("materialText").get("minLength").asInt());
        assertEquals(20000, request.get("properties").get("materialText").get("maxLength").asInt());
        assertEquals(200, request.get("properties").get("title").get("maxLength").asInt());
        var response = operation.get("responses").get("201").get("content").get("application/json").get("schema");
        assertEquals("[\"taskId\",\"status\",\"result\"]", response.get("required").toString());
        assertEquals("uuid", response.get("properties").get("taskId").get("format").asString());
        assertEquals("COMPLETED", response.get("properties").get("status").get("const").asString());
        var result = response.get("properties").get("result");
        assertEquals("[\"verdict\",\"issues\"]", result.get("required").toString());
        assertEquals("[\"NO_ISSUES\",\"ISSUES_FOUND\"]", result.get("properties").get("verdict").get("enum").toString());
        assertEquals("[\"message\"]", result.get("properties").get("issues").get("items").get("required").toString());
        assertEquals(1, result.get("allOf").get(0).get("then").get("properties").get("issues").get("minItems").asInt());
        assertEquals(0, result.get("allOf").get(1).get("then").get("properties").get("issues").get("maxItems").asInt());
    }

    @Test void checkControllerOnlyExposesJsonPostAndKeepsTheThreeDependencies() throws Exception {
        String source = Files.readString(root().resolve("apps/api/src/main/java/com/dreamcore/workspace/qualityops/CheckTaskController.java"));
        assertTrue(source.contains("consumes = \"application/json\""));
        assertFalse(source.contains("GetMapping"));
        assertFalse(source.contains("MultipartFile"));
        var constructors = com.dreamcore.workspace.qualityops.CheckTaskController.class.getConstructors();
        assertEquals(1, constructors.length);
        assertEquals(Set.of(com.dreamcore.workspace.capability.registry.CapabilityCatalogPort.class,
                com.dreamcore.workspace.identity.IdentityService.class,
                com.dreamcore.workspace.qualityops.CheckTaskService.class), Set.of(constructors[0].getParameterTypes()));
    }
}
