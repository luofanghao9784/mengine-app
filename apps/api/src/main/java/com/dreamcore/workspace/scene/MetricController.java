package com.dreamcore.workspace.scene;
import java.util.UUID;
import jakarta.servlet.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping({"/api/platform-admin/v1/tenants/{tenant}/scene/metrics","/api/tenant-admin/v1/tenants/{tenant}/scene/metrics"})
public class MetricController {
 private final MetricCatalog catalog;private final MetricDraftGenerator generator;public MetricController(MetricCatalog catalog,MetricDraftGenerator generator){this.catalog=catalog;this.generator=generator;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 private boolean platform(HttpServletRequest r){return r.getRequestURI().startsWith("/api/platform-admin/");}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 public record Automatic(boolean enabled) {}
 @GetMapping("/generation") public Object generation(Authentication a,@PathVariable UUID tenant,HttpServletRequest r){return generator.status(actor(a),tenant,platform(r));}
 @PostMapping("/generation") public Object generate(Authentication a,@PathVariable UUID tenant,HttpServletRequest r){return generator.generate(actor(a),tenant,platform(r));}
 @PostMapping("/automatic") public Object automatic(Authentication a,@PathVariable UUID tenant,@RequestBody Automatic body,HttpServletRequest r){return generator.setting(actor(a),tenant,platform(r),body.enabled());}
 @GetMapping public Object list(Authentication a,@PathVariable UUID tenant,HttpServletRequest r){return catalog.list(actor(a),tenant,platform(r));}
 @PostMapping public Object save(Authentication a,@PathVariable UUID tenant,@RequestBody MetricCatalog.Change body,HttpServletRequest r){return catalog.save(actor(a),tenant,platform(r),body);}
 @PostMapping("/{id}/publish") public Object publish(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody MetricCatalog.Transition body,HttpServletRequest r){return catalog.transition(actor(a),tenant,platform(r),id,body,true);}
 @PostMapping("/{id}/withdraw") public Object withdraw(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody MetricCatalog.Transition body,HttpServletRequest r){return catalog.transition(actor(a),tenant,platform(r),id,body,false);}
}
