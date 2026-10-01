package com.dreamcore.workspace.evaluation;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping({"/api/v1/tenants/{tenant}/evaluation","/api/platform-admin/v1/evaluation"})
public class EvaluationController {
 public record CreateAsset(@NotNull UUID requestId,UUID workspaceId,@NotNull String kind,@NotNull EvaluationService.Content content,@NotNull List<EvaluationAccess.Evidence> evidence){}
 public record ReviseAsset(@NotNull UUID requestId,@Min(1) int expectedRevision,EvaluationService.Content content,List<EvaluationAccess.Evidence> evidence,boolean withdraw){}
 public record Run(@NotNull UUID requestId,UUID workspaceId,@NotNull UUID standardVersion,@NotNull List<UUID> sampleVersions,UUID supersedes,@NotNull List<EvaluationService.Judgment> judgments){}
 public record CreateIssue(@NotNull UUID requestId,UUID workspaceId,@NotNull EvaluationIssueService.Create issue){}
 public record ChangeIssue(@NotNull UUID requestId,@Min(1) int expectedRevision,@NotNull EvaluationIssueService.Change change){}
 private final EvaluationService service;private final EvaluationIssueService issues;public EvaluationController(EvaluationService service,EvaluationIssueService issues){this.service=service;this.issues=issues;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @ModelAttribute public void cache(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping("/scope") public EvaluationService.Scope scope(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam(required=false) UUID workspace){return service.scope(actor(auth),tenant,workspace);}
 @GetMapping("/evidence-options") public EvaluationService.EvidenceOptions options(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam UUID workspace,@RequestParam String kind,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.options(actor(auth),tenant,workspace,kind,offset,limit);}
 @GetMapping("/evidence") public EvaluationService.EvidenceDetails evidence(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam UUID workspace,@RequestParam String kind,@RequestParam UUID id,@RequestParam int revision,@RequestParam int attempt){return service.details(actor(auth),tenant,workspace,new EvaluationAccess.Evidence(kind,id,revision,attempt));}
 @GetMapping("/assets") public EvaluationService.Assets list(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam String kind,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,workspace,kind,offset,limit);}
 @GetMapping("/assets/{id}") public EvaluationService.Asset get(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id,@RequestParam(required=false) Integer revision){return service.get(actor(auth),tenant,id,revision);}
 @GetMapping("/versions/{id}") public EvaluationService.Asset version(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id){return service.byVersion(actor(auth),tenant,id);}
 @PostMapping("/assets") @ResponseStatus(HttpStatus.CREATED) public EvaluationService.Asset create(Authentication auth,@PathVariable(required=false) UUID tenant,@Valid @RequestBody CreateAsset body){return service.create(actor(auth),tenant,body.workspaceId(),body.requestId(),body.kind(),body.content(),body.evidence());}
 @PutMapping("/assets/{id}") public EvaluationService.Asset revise(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id,@Valid @RequestBody ReviseAsset body){return service.revise(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.content(),body.evidence(),body.withdraw());}
 @GetMapping("/runs") public EvaluationService.Evaluations runs(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.evaluations(actor(auth),tenant,workspace,offset,limit);}
 @GetMapping("/runs/{id}") public EvaluationService.Evaluation run(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id){return service.evaluation(actor(auth),tenant,id);}
 @PostMapping("/runs") @ResponseStatus(HttpStatus.CREATED) public EvaluationService.Evaluation evaluate(Authentication auth,@PathVariable(required=false) UUID tenant,@Valid @RequestBody Run body){return service.evaluate(actor(auth),tenant,body.workspaceId(),body.requestId(),body.standardVersion(),body.sampleVersions(),body.supersedes(),body.judgments());}
 @GetMapping("/issues") public EvaluationIssueService.Page issues(Authentication auth,@PathVariable(required=false) UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return issues.list(actor(auth),tenant,workspace,offset,limit);}
 @GetMapping("/issues/{id}") public EvaluationIssueService.Issue issue(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id){return issues.get(actor(auth),tenant,id);}
 @GetMapping("/issues/{id}/assignees") public List<EvaluationIssueService.Assignee> assignees(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id){return issues.assignees(actor(auth),tenant,id);}
 @PostMapping("/issues") @ResponseStatus(HttpStatus.CREATED) public EvaluationIssueService.Issue createIssue(Authentication auth,@PathVariable(required=false) UUID tenant,@Valid @RequestBody CreateIssue body){return issues.create(actor(auth),tenant,body.workspaceId(),body.requestId(),body.issue());}
 @PostMapping("/issues/{id}/actions") public EvaluationIssueService.Issue changeIssue(Authentication auth,@PathVariable(required=false) UUID tenant,@PathVariable UUID id,@Valid @RequestBody ChangeIssue body){return issues.change(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.change());}
}
