package com.dreamcore.workspace.identity;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.UnexpectedRollbackException;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@ExtendWith(OutputCaptureExtension.class)
class IdentityErrorsDiagnosticTest {
    @RestController static class FailingController {
        @GetMapping("/test-failure") Object failure() {
            throw new IllegalStateException("password=synthetic-secret; SELECT private_business_value",
                new UnexpectedRollbackException("private_nested_content"));
        }
    }
    @Test void unexpectedErrorIsCorrelatedWithoutLoggingMessagesOrRequestData(CapturedOutput output) throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new FailingController()).setControllerAdvice(new IdentityErrors()).build();
        var response = mvc.perform(get("/test-failure").param("token","synthetic-request-secret")).andReturn().getResponse();
        assertEquals(500,response.getStatus());
        var body = new JsonMapper().readTree(response.getContentAsString());
        assertEquals("INTERNAL_ERROR",body.path("code").asText());
        String id = body.path("errorId").asText(); assertDoesNotThrow(() -> UUID.fromString(id));
        assertEquals(id,response.getHeader("X-Error-ID")); assertEquals("no-store",response.getHeader("Cache-Control"));
        assertTrue(output.getAll().contains(id));
        assertTrue(output.getAll().contains("UnexpectedRollbackException"));
        assertTrue(output.getAll().contains("FailingController.failure"));
        for(String secret : new String[]{"synthetic-secret","private_business_value","private_nested_content","synthetic-request-secret"}) {
            assertFalse(output.getAll().contains(secret)); assertFalse(response.getContentAsString().contains(secret));
        }
    }
}
