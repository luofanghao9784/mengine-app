package com.dreamcore.workspace.feedback;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/feedback")
public class FeedbackController {
 public record Create(@NotNull UUID requestId,@NotNull FeedbackService.Target target,@NotNull FeedbackService.Assessment assessment) {}
 public record Edit(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull FeedbackService.Assessment assessment) {}
 public record Withdraw(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision) {}
 public record Act(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull FeedbackService.FollowUp action) {}
 private final FeedbackService service;public FeedbackController(FeedbackService service){this.service=service;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public FeedbackService.Lookup lookup(Authentication a,@PathVariable UUID tenant,@RequestParam String kind,@RequestParam(required=false) UUID taskId,@RequestParam int taskRevision,@RequestParam int attempt,@RequestParam String presentationVersion,@RequestParam int presentationRevision,@RequestParam(required=false) UUID publicationId,@RequestParam(required=false) UUID materialVersionId,@RequestParam(required=false) Integer materialVersion){return service.lookup(actor(a),tenant,new FeedbackService.Target(kind,taskId,taskRevision,attempt,presentationVersion,presentationRevision,publicationId,materialVersionId,materialVersion));}
 @GetMapping("/preferences") public FeedbackService.Preferences preferences(Authentication a,@PathVariable UUID tenant){return service.preferences(actor(a),tenant);}
 @GetMapping("/{id}") public FeedbackService.Feedback get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(actor(a),tenant,id);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public FeedbackService.Feedback create(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Create b){return service.create(actor(a),tenant,b.requestId(),b.target(),b.assessment());}
 @PostMapping("/{id}") public FeedbackService.Feedback edit(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Edit b){return service.edit(actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.assessment(),false);}
 @PostMapping("/{id}/withdraw") public FeedbackService.Feedback withdraw(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Withdraw b){return service.edit(actor(a),tenant,id,b.requestId(),b.expectedRevision(),null,true);}
 @GetMapping("/{id}/history") public FeedbackService.History history(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.history(actor(a),tenant,id,offset,limit);}
 @GetMapping("/{id}/actions") public FeedbackService.Actions actions(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.actions(actor(a),tenant,id,offset,limit);}
 @PostMapping("/{id}/actions") @ResponseStatus(HttpStatus.CREATED) public FeedbackService.Action act(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Act b){return service.followUp(actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.action());}
}
