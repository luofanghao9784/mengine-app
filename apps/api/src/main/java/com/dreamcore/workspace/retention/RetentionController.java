package com.dreamcore.workspace.retention;
import jakarta.servlet.http.HttpServletResponse;import jakarta.validation.Valid;import jakarta.validation.constraints.*;
import java.util.*;import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;import org.springframework.http.HttpStatus;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/retention")
public class RetentionController {
 public record Policy(@NotNull UUID requestId,@Min(0)int expectedRevision,@Min(1)@Max(3650)int days,@NotBlank@Size(max=500)String reason){}
 public record Create(@NotNull UUID requestId,@NotNull String kind,UUID targetAccountId,@NotBlank@Size(max=100)String label,@NotNull@Size(max=50)List<UUID> workspaceIds){}
 public record Command(@NotNull UUID requestId,@Min(1)int expectedRevision,@NotNull String action,List<RetentionService.Check> checklist){}
 private final RetentionService service;public RetentionController(RetentionService service){this.service=service;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping("/policies")public RetentionService.Catalogue catalogue(Authentication a,@PathVariable UUID tenant){return service.catalogue(actor(a),tenant);}
 @PostMapping("/policies/{key}")public RetentionService.Policy configure(Authentication a,@PathVariable UUID tenant,@PathVariable String key,@Valid@RequestBody Policy b){return service.configure(actor(a),tenant,key,b.requestId(),b.expectedRevision(),b.days(),b.reason());}
 @GetMapping("/policies/{key}/history")public RetentionService.PolicyPage policyHistory(Authentication a,@PathVariable UUID tenant,@PathVariable String key,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.policyHistory(actor(a),tenant,key,offset,limit);}
 @GetMapping("/options")public RetentionService.Options options(Authentication a,@PathVariable UUID tenant,@RequestParam String kind,@RequestParam(defaultValue="0")int memberOffset,@RequestParam(defaultValue="0")int spaceOffset,@RequestParam(defaultValue="20")int limit){return service.options(actor(a),tenant,kind,memberOffset,spaceOffset,limit);}
 @GetMapping("/cases")public RetentionService.Cases list(Authentication a,@PathVariable UUID tenant,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.list(actor(a),tenant,offset,limit);}
 @PostMapping("/cases")@ResponseStatus(HttpStatus.CREATED)public RetentionService.Case create(Authentication a,@PathVariable UUID tenant,@Valid@RequestBody Create b){return service.create(actor(a),tenant,b.requestId(),b.kind(),b.targetAccountId(),b.label(),b.workspaceIds());}
 @GetMapping("/cases/{id}")public RetentionService.Case get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(required=false)Integer revision){return service.get(actor(a),tenant,id,revision);}
 @GetMapping("/cases/{id}/history")public RetentionService.History history(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.history(actor(a),tenant,id,offset,limit);}
 @PostMapping("/cases/{id}")public RetentionService.Case command(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid@RequestBody Command b){return service.command(actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.action(),b.checklist());}
}
