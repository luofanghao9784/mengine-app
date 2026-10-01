package com.dreamcore.workspace.plans;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/plans")
public class PlanController {
 public record Create(@NotNull UUID requestId,@NotNull PlanService.Configuration configuration){}
 public record Update(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull PlanService.Configuration configuration){}
 public record Action(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull String action,boolean delegationAccepted){}
 private final PlanService service;private final PlanAttentionService attention;public PlanController(PlanService service,PlanAttentionService attention){this.service=service;this.attention=attention;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @ModelAttribute public void cache(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public PlanService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,offset,limit);}
 @GetMapping("/attention") public PlanAttentionService.Page attention(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return attention.list(actor(auth),tenant,offset,limit);}
 @GetMapping("/{id}") public PlanService.Plan get(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(actor(auth),tenant,id);}
 @GetMapping("/{id}/versions/{revision}") public PlanService.ConfigurationVersion version(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable int revision){return service.version(actor(auth),tenant,id,revision);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public PlanService.Plan create(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Create body){return service.create(actor(auth),tenant,body.requestId(),body.configuration());}
 @PutMapping("/{id}") public PlanService.Plan update(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Update body){return service.update(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.configuration());}
 @PostMapping("/{id}/actions") public PlanService.Plan action(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Action body){return service.action(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.action(),body.delegationAccepted());}
 @GetMapping("/{id}/runs") public PlanService.Runs runs(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.runs(actor(auth),tenant,id,offset,limit);}
}
