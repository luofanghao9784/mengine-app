package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1/auth")
public class PlatformIdentityController {
    private final PlatformIdentity identities;
    public PlatformIdentityController(PlatformIdentity identities) { this.identities=identities; }
    public record Login(@NotNull @Size(max=254) String username,@NotNull @Size(max=128) String password) {}
    @GetMapping("/csrf") public Map<String,String> csrf(HttpServletRequest request,HttpServletResponse response) { return identities.csrf(request,response); }
    @PostMapping("/login") public IdentityService.Me login(@Valid @RequestBody Login body,HttpServletRequest request,HttpServletResponse response) {
        return identities.login(body.username(),body.password(),request,response);
    }
    public record Password(@NotNull @Size(max=128) String currentPassword,@NotNull @Size(min=6,max=128) String password) {}
    @PostMapping("/password") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void password(Authentication auth,@Valid @RequestBody Password body,HttpServletRequest request,HttpServletResponse response) {
        identities.changePassword(IdentityController.actor(auth),body.currentPassword(),body.password(),request,response);
    }
    @GetMapping("/me") public IdentityService.Me me(Authentication auth) { return identities.me(IdentityController.actor(auth)); }
    @PostMapping("/logout") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request,HttpServletResponse response) { identities.logout(request,response); }
}
