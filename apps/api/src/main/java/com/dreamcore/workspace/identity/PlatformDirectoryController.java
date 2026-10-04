package com.dreamcore.workspace.identity;
import java.util.List;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1")
public class PlatformDirectoryController {
    private final PlatformDirectoryService service;
    public PlatformDirectoryController(PlatformDirectoryService service){this.service=service;}
    public record Status(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion,@NotNull String status,@NotBlank @Size(max=500) String reason) {}
    @GetMapping("/accounts") public List<PlatformDirectoryService.Customer> customers(Authentication auth,@RequestParam(defaultValue="")String q,@RequestParam(defaultValue="")String status,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="21")int limit){return service.customers(IdentityController.actor(auth),q,status,offset,limit);}
    @GetMapping("/accounts/{id}") public PlatformDirectoryService.Detail detail(Authentication auth,@PathVariable UUID id){return service.detail(IdentityController.actor(auth),id);}
    @PostMapping("/accounts/{id}/status") public PlatformDirectoryService.Detail status(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Status body){return service.status(IdentityController.actor(auth),id,body.requestId(),body.expectedVersion(),body.status(),body.reason());}
    @GetMapping("/staff") public List<PlatformDirectoryService.Staff> staff(Authentication auth){return service.staff(IdentityController.actor(auth));}
}
