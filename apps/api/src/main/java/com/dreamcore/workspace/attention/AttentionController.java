package com.dreamcore.workspace.attention;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/attention")
public class AttentionController {
    private final AttentionService service;
    public AttentionController(AttentionService service){this.service=service;}
    @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
    @GetMapping public AttentionService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="false") boolean managed,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return service.list(UUID.fromString(auth.getName()),tenant,managed,offset,limit);}
}
