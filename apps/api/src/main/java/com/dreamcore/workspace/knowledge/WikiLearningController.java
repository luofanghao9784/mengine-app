package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/wiki-learning")
public class WikiLearningController {
 private final WikiLearningService service;
 public WikiLearningController(WikiLearningService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public WikiLearningService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset){return service.list(UUID.fromString(auth.getName()),tenant,offset);}
 @GetMapping("/{id}") public WikiLearningService.Draft detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.detail(UUID.fromString(auth.getName()),tenant,id);}
 @PostMapping("/sources/{material}") public WikiLearningService.Draft start(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID material,@RequestBody WikiLearningService.Start body){return service.start(UUID.fromString(auth.getName()),tenant,material,body);}
}
