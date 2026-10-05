package com.dreamcore.workspace.news;
import java.util.*;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
public class NewsSourceController {
 private final NewsSourceCatalog catalog;public NewsSourceController(NewsSourceCatalog catalog){this.catalog=catalog;}
 public record Selection(UUID sourceId,int revision,boolean enabled) {}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/news-sources") public List<NewsSourceCatalog.Source> global(Authentication a){return catalog.list(actor(a),null);}
 @PostMapping("/api/platform-admin/v1/news-sources") public NewsSourceCatalog.Source save(Authentication a,@RequestBody NewsSourceCatalog.Change c){return catalog.save(actor(a),c);}
 @GetMapping("/api/v1/tenants/{tenant}/news-sources") public List<NewsSourceCatalog.Source> list(Authentication a,@PathVariable UUID tenant){return catalog.list(actor(a),tenant);}
 @PostMapping("/api/v1/tenants/{tenant}/news-sources") public List<NewsSourceCatalog.Source> select(Authentication a,@PathVariable UUID tenant,@RequestBody Selection s){return catalog.select(actor(a),tenant,s.sourceId(),s.revision(),s.enabled());}
}
