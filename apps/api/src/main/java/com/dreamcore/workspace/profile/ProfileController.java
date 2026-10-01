package com.dreamcore.workspace.profile;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/profiles")
public class ProfileController {
    public record Create(@NotNull UUID requestId,@NotNull @Size(max=100) String key,@NotNull ProfileService.Kind kind,@NotNull @Size(max=4000) String value,@NotNull @Size(max=500) String provenance,@NotNull ProfileService.Status status,Instant expiresAt) {
        ProfileService.Content content(){return new ProfileService.Content(value,provenance,status,expiresAt);}
    }
    public record Save(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull @Size(max=4000) String value,@NotNull @Size(max=500) String provenance,@NotNull ProfileService.Status status,Instant expiresAt) {
        ProfileService.Content content(){return new ProfileService.Content(value,provenance,status,expiresAt);}
    }
    public record Withdraw(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision) {}
    private final ProfileService service;
    public ProfileController(ProfileService service){this.service=service;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
    @GetMapping("/{scope}/{subject}") public ProfileService.Page list(Authentication auth,@PathVariable UUID tenant,@PathVariable ProfileService.Scope scope,@PathVariable UUID subject,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return service.list(actor(auth),tenant,scope,subject,offset,limit);}
    @PostMapping("/{scope}/{subject}") public ProfileService.Value create(Authentication auth,@PathVariable UUID tenant,@PathVariable ProfileService.Scope scope,@PathVariable UUID subject,@Valid @RequestBody Create body){return service.create(actor(auth),tenant,scope,subject,body.key(),body.kind(),body.content(),body.requestId());}
    @GetMapping("/entries/{id}") public ProfileService.Value get(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(required=false) Integer version){return service.get(actor(auth),tenant,id,version);}
    @GetMapping("/entries/{id}/versions") public ProfileService.History history(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return service.history(actor(auth),tenant,id,offset,limit);}
    @PostMapping("/entries/{id}/versions") public ProfileService.Value save(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Save body){return service.save(actor(auth),tenant,id,body.expectedRevision(),body.content(),body.requestId());}
    @PostMapping("/entries/{id}/withdraw") public ProfileService.Value withdraw(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Withdraw body){return service.withdraw(actor(auth),tenant,id,body.expectedRevision(),body.requestId());}
}
