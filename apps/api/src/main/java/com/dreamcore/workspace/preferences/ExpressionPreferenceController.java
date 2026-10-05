package com.dreamcore.workspace.preferences;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
public class ExpressionPreferenceController {
 private final ExpressionPreferences service;private final ExpressionRuleBooks books;public ExpressionPreferenceController(ExpressionPreferences service,ExpressionRuleBooks books){this.service=service;this.books=books;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/expression-preferences") public ExpressionPreferences.Page global(Authentication a){return service.read(UUID.fromString(a.getName()),null,"GLOBAL");}
 @GetMapping("/api/platform-admin/v1/expression-preferences/records") public ExpressionPreferences.Records globalRecords(Authentication a,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.records(UUID.fromString(a.getName()),null,"GLOBAL",offset,limit);}
 @GetMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences/records") public ExpressionPreferences.Records records(Authentication a,@PathVariable UUID tenant,@RequestParam String scope,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.records(UUID.fromString(a.getName()),tenant,scope,offset,limit);}
 @PostMapping("/api/platform-admin/v1/expression-preferences") public ExpressionPreferences.Page saveGlobal(Authentication a,@RequestBody ExpressionPreferences.Change c){return service.save(UUID.fromString(a.getName()),null,"GLOBAL",c);}
 @GetMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences") public ExpressionPreferences.Page scoped(Authentication a,@PathVariable UUID tenant,@RequestParam String scope){return service.read(UUID.fromString(a.getName()),tenant,scope);}
 @PostMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences") public ExpressionPreferences.Page save(Authentication a,@PathVariable UUID tenant,@RequestParam String scope,@RequestBody ExpressionPreferences.Change c){return service.save(UUID.fromString(a.getName()),tenant,scope,c);}
 @GetMapping("/api/platform-admin/v1/expression-preferences/books") public ExpressionRuleBooks.Page globalBooks(Authentication a){return books.read(UUID.fromString(a.getName()),null,"GLOBAL");}
 @PostMapping("/api/platform-admin/v1/expression-preferences/books") public ExpressionRuleBooks.Page saveGlobalBooks(Authentication a,@RequestBody ExpressionRuleBooks.Change c){return books.save(UUID.fromString(a.getName()),null,"GLOBAL",c);}
 @GetMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences/books") public ExpressionRuleBooks.Page scopedBooks(Authentication a,@PathVariable UUID tenant,@RequestParam String scope){return books.read(UUID.fromString(a.getName()),tenant,scope);}
 @PostMapping("/api/v1/tenants/{tenant}/profiles/expression-preferences/books") public ExpressionRuleBooks.Page saveBooks(Authentication a,@PathVariable UUID tenant,@RequestParam String scope,@RequestBody ExpressionRuleBooks.Change c){return books.save(UUID.fromString(a.getName()),tenant,scope,c);}
}
