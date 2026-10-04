package com.dreamcore.workspace.lifecycle;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/workspaces/{space}/lifecycle")
public class MaterialLifecycleController {
    public record Action(@NotNull UUID requestId,@Min(0) int expectedRevision,@NotNull String action) {}
    private final MaterialLifecycleService service;
    public MaterialLifecycleController(MaterialLifecycleService service){this.service=service;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public MaterialLifecycleService.Page list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="ALL") String view,@RequestParam(defaultValue="") String query){return service.list(actor(a),tenant,space,offset,limit,view,query);}
    @GetMapping("/{kind}/{id}") public MaterialLifecycleService.Preview preview(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable String kind,@PathVariable UUID id){return service.preview(actor(a),tenant,space,kind,id);}
    @PostMapping("/{kind}/{id}") public MaterialLifecycleService.Receipt act(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable String kind,@PathVariable UUID id,@Valid @RequestBody Action b){return service.act(actor(a),tenant,space,kind,id,b.requestId(),b.expectedRevision(),b.action());}
    @GetMapping("/cleanup/{id}") public MaterialLifecycleService.Cleanup cleanup(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable UUID id){return service.cleanup(actor(a),tenant,space,id);}
}
