package com.dreamcore.workspace.preferences;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
public class ExpressionPreferenceController {
 private final ExpressionPreferences service;public ExpressionPreferenceController(ExpressionPreferences service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/expression-preferences") public ExpressionPreferences.Page global(Authentication a){return service.read(UUID.fromString(a.getName()),null,"GLOBAL");}
 @PostMapping("/api/platform-admin/v1/expression-preferences") public ExpressionPreferences.Page saveGlobal(Authentication a,@RequestBody ExpressionPreferences.Change c){return service.save(UUID.fromString(a.getName()),null,"GLOBAL",c);}
 @GetMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences") public ExpressionPreferences.Page scoped(Authentication a,@PathVariable UUID tenant,@RequestParam String scope){return service.read(UUID.fromString(a.getName()),tenant,scope);}
 @PostMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences") public ExpressionPreferences.Page save(Authentication a,@PathVariable UUID tenant,@RequestParam String scope,@RequestBody ExpressionPreferences.Change c){return service.save(UUID.fromString(a.getName()),tenant,scope,c);}
}
