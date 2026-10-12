package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/wiki-articles")
public class WikiArticleController {
 private final WikiArticleService service;
 public WikiArticleController(WikiArticleService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public WikiArticleService.Page list(Authentication a,@PathVariable UUID tenant,@RequestParam(defaultValue="false") boolean archived,@RequestParam(defaultValue="0") int offset){return service.list(UUID.fromString(a.getName()),tenant,archived,offset);}
 @GetMapping("/prepare/{draft}") public WikiArticleService.Preparation prepare(Authentication a,@PathVariable UUID tenant,@PathVariable UUID draft){return service.prepare(UUID.fromString(a.getName()),tenant,draft);}
 @PostMapping("/publish/{draft}") public WikiArticleService.Item publish(Authentication a,@PathVariable UUID tenant,@PathVariable UUID draft,@RequestBody WikiArticleService.Publish b){return service.publish(UUID.fromString(a.getName()),tenant,draft,b);}
 @GetMapping("/{id}") public WikiArticleService.Item detail(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.detail(UUID.fromString(a.getName()),tenant,id);}
 @PostMapping("/{id}") public WikiArticleService.Item change(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody WikiArticleService.Change b){return service.change(UUID.fromString(a.getName()),tenant,id,b);}
 @GetMapping("/{id}/history") public WikiArticleService.HistoryPage history(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset){return service.history(UUID.fromString(a.getName()),tenant,id,offset);}
}
