package com.dreamcore.workspace.methods;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1/methods")
public class MethodController {
 public record Create(@NotNull UUID requestId,@NotNull String title,@NotNull MethodSelection.Configuration configuration,@NotNull String rationale){}
 public record Candidate(@NotNull UUID requestId,@Min(1) int expectedRevision,@NotNull MethodSelection.Configuration configuration,@NotNull String rationale){}
 public record Compare(@NotNull UUID requestId,@NotNull UUID candidateVersion,UUID baselineVersion,@NotNull UUID standardVersion,@NotNull List<UUID> sampleVersions){}
 public record Publish(@NotNull UUID requestId,@Min(1) int expectedRevision,@NotNull UUID candidateVersion,@NotNull UUID comparisonId){}
 public record Suite(@NotNull UUID requestId,@NotNull String title,@NotNull MethodService.RankingInput input,@NotNull MethodService.Expected expected){}
 private final MethodService service;public MethodController(MethodService service){this.service=service;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @ModelAttribute public void cache(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public MethodService.Families list(Authentication auth,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),null,offset,limit);}
 @GetMapping("/{id}") public MethodService.Family get(Authentication auth,@PathVariable UUID id){return service.get(actor(auth),id);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public MethodService.Family create(Authentication auth,@Valid @RequestBody Create b){return service.create(actor(auth),b.requestId(),b.title(),b.configuration(),b.rationale());}
 @PostMapping("/sample-suite") @ResponseStatus(HttpStatus.CREATED) public MethodService.Suite suite(Authentication auth,@Valid @RequestBody Suite b){return service.suite(actor(auth),b.requestId(),b.title(),b.input(),b.expected());}
 @PostMapping("/{id}/candidates") public MethodService.Family candidate(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Candidate b){return service.candidate(actor(auth),id,b.requestId(),b.expectedRevision(),b.configuration(),b.rationale());}
 @PostMapping("/comparisons") @ResponseStatus(HttpStatus.CREATED) public MethodService.Comparison compare(Authentication auth,@Valid @RequestBody Compare b){return service.compare(actor(auth),b.requestId(),b.candidateVersion(),b.baselineVersion(),b.standardVersion(),b.sampleVersions());}
 @GetMapping("/{id}/comparisons") public MethodService.Comparisons comparisons(Authentication auth,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.comparisons(actor(auth),id,offset,limit);}
 @PostMapping("/{id}/publish") public MethodService.Family publish(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Publish b){return service.publish(actor(auth),id,b.requestId(),b.expectedRevision(),b.candidateVersion(),b.comparisonId());}
}
