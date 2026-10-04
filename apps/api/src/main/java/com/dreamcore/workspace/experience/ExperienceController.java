package com.dreamcore.workspace.experience;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/workspaces/{workspace}/experiences")
public class ExperienceController {
 public record Draft(@NotNull UUID requestId,@NotNull ExperienceService.Content content,@NotNull List<ExperienceService.Evidence> evidence) {}
 public record Revision(@NotNull UUID requestId,@NotNull Integer expectedRevision,@NotNull ExperienceService.Content content,@NotNull List<ExperienceService.Evidence> evidence) {}
 public record Publish(@NotNull UUID requestId,@NotNull Integer expectedRevision,@NotNull UUID versionId,@NotNull Boolean independentCopyConfirmed) {}
 public record Restore(@NotNull UUID requestId,@NotNull Integer expectedRevision,@NotNull UUID versionId) {}
 public record Withdraw(@NotNull UUID requestId,@NotNull Integer expectedRevision) {}
 public record Use(@NotNull UUID requestId,@NotNull ExperienceService.UseInput use) {}
 public record Feedback(@NotNull UUID requestId,@NotNull String result,@NotNull String note) {}
 private final ExperienceService service; public ExperienceController(ExperienceService service){this.service=service;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public ExperienceService.Page list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="") String tag,@RequestParam(defaultValue="false") boolean maintenance,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(a),tenant,workspace,query,tag,maintenance,offset,limit);}
 @GetMapping("/{id}") public ExperienceService.Entry get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@RequestParam(required=false) UUID version){return service.get(actor(a),tenant,workspace,id,version);}
 @PostMapping public ExperienceService.Entry create(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@Valid @RequestBody Draft b){return service.retiredManualWrite(actor(a),tenant,workspace,true);}
 @PostMapping("/{id}/versions") public ExperienceService.Entry revise(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Revision b){return service.retiredManualWrite(actor(a),tenant,workspace,true);}
 @GetMapping("/{id}/versions") public ExperienceService.Versions versions(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.versions(actor(a),tenant,workspace,id,offset,limit);}
 @PostMapping("/{id}/publish") public ExperienceService.Entry publish(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Publish b){return service.retiredManualWrite(actor(a),tenant,workspace,true);}
 @PostMapping("/{id}/withdraw") public ExperienceService.Entry withdraw(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Withdraw b){return service.retiredManualWrite(actor(a),tenant,workspace,true);}
 @PostMapping("/{id}/stop") public ExperienceService.Availability stop(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Restore b){return service.stop(actor(a),tenant,workspace,id,b.requestId(),b.expectedRevision(),b.versionId());}
 @PostMapping("/{id}/restore") public ExperienceService.Entry restore(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Restore b){return service.restore(actor(a),tenant,workspace,id,b.requestId(),b.expectedRevision(),b.versionId());}
 @GetMapping("/{id}/events") public ExperienceService.Events events(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.events(actor(a),tenant,workspace,id,offset,limit);}
 @PostMapping("/{id}/uses") public ExperienceService.Use use(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@Valid @RequestBody Use b){return service.retiredManualWrite(actor(a),tenant,workspace,false);}
 @GetMapping("/{id}/uses") public ExperienceService.Uses uses(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.uses(actor(a),tenant,workspace,id,offset,limit);}
 @PostMapping("/{id}/uses/{use}/feedback") public ExperienceService.Feedback feedback(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@PathVariable UUID use,@Valid @RequestBody Feedback b){return service.retiredManualWrite(actor(a),tenant,workspace,false);}
 @GetMapping("/{id}/uses/{use}/feedback") public ExperienceService.Feedbacks feedbacks(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID id,@PathVariable UUID use,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.feedbacks(actor(a),tenant,workspace,id,use,offset,limit);}
}
