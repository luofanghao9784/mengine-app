package com.dreamcore.workspace.knowledge;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}")
public class KnowledgeController {
    public record ParseRequest(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedGeneration) {}
    private final KnowledgeService service; private final MaterialProcessingService processing;
    public KnowledgeController(KnowledgeService service,MaterialProcessingService processing) {this.service=service;this.processing=processing;}
    private UUID actor(Authentication auth) {return UUID.fromString(auth.getName());}
    @ModelAttribute public void privateResponse(HttpServletResponse response) {response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping("/workspaces/{workspace}/materials/{material}/versions/{version}/analysis")
    public KnowledgeService.Analysis analysis(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID material,@PathVariable UUID version,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit) {
        return service.analysis(actor(auth),tenant,workspace,material,version,offset,limit);
    }
    @PostMapping("/workspaces/{workspace}/materials/{material}/versions/{version}/analysis") @ResponseStatus(HttpStatus.ACCEPTED)
    public KnowledgeService.Analysis parse(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID material,@PathVariable UUID version,@Valid @RequestBody ParseRequest body) {
        return service.request(actor(auth),tenant,workspace,material,version,body.requestId(),body.expectedGeneration());
    }
    @GetMapping("/knowledge/processing")
    public MaterialProcessingService.Page processing(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspace,
            @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="ALL") String state,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){
        return processing.list(actor(auth),tenant,workspace,q,state,offset,limit);
    }
    @GetMapping("/knowledge/search")
    public KnowledgeService.Results search(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam String q,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit) {
        return service.search(actor(auth),tenant,workspace,q,offset,limit);
    }
    @GetMapping("/knowledge/chunks/{chunk}")
    public KnowledgeService.Chunk chunk(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID chunk) {return service.citation(actor(auth),tenant,chunk);}
}
