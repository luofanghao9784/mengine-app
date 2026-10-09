package com.dreamcore.workspace.analysis;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Optional developer/acceptance API. It cannot publish or grant access to another owner. */
@RestController
@RequestMapping("/api/v1/tenants/{tenant}/analysis-materials")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.analysis.material-api-enabled",havingValue="true")
public class CalculationMaterialController {
    public record Retain(@NotNull UUID artifactId,@NotNull UUID materialId,
                         @NotNull @Min(0) Integer expectedVersion,@NotNull Instant validUntil) {}
    private final CalculationMaterialService service;
    public CalculationMaterialController(CalculationMaterialService service) { this.service=service; }
    @ModelAttribute public void headers(HttpServletResponse response) {
        response.setHeader("Cache-Control","private, no-store");
        response.setHeader("X-Content-Type-Options","nosniff");
    }
    @PostMapping public CalculationMaterialService.Version retain(Authentication auth,@PathVariable UUID tenant,
                                                                 @Valid @RequestBody Retain request) {
        return service.retain(UUID.fromString(auth.getName()),tenant,request.artifactId(),request.materialId(),
            request.expectedVersion(),request.validUntil());
    }
    @GetMapping("/{material}/versions/{number}")
    public CalculationMaterialService.Version read(Authentication auth,@PathVariable UUID tenant,
                                                    @PathVariable UUID material,@PathVariable int number) {
        // History API returns explicit state and original evidence; it does not approve current delivery.
        return service.read(UUID.fromString(auth.getName()),tenant,material,number,false);
    }
}
