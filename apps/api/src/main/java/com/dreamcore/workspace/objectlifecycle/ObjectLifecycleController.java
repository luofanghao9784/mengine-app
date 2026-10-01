package com.dreamcore.workspace.objectlifecycle;
import jakarta.servlet.http.HttpServletResponse;import jakarta.validation.Valid;import jakarta.validation.constraints.*;
import java.util.*;import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping({"/api/v1/tenants/{tenant}/object-lifecycle","/api/platform-admin/v1/object-lifecycle"})
public class ObjectLifecycleController {
 public record Action(@NotNull UUID requestId,@Min(0) int expectedRevision,@NotNull String action,boolean irreversibleConfirmed) {}
 private final ObjectLifecycleService service;public ObjectLifecycleController(ObjectLifecycleService service){this.service=service;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void cache(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public ObjectLifecycleService.Page list(Authentication a,@PathVariable(required=false) UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam(required=false) String kind,@RequestParam(required=false) String state,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(a),tenant,workspace,kind,state,offset,limit);}
 @GetMapping("/{kind}/{id}") public ObjectLifecycleService.Preview get(Authentication a,@PathVariable(required=false) UUID tenant,@PathVariable String kind,@PathVariable UUID id){return service.preview(actor(a),tenant,kind,id);}
 @GetMapping("/{kind}/{id}/history") public ObjectLifecycleService.Events history(Authentication a,@PathVariable(required=false) UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.history(actor(a),tenant,kind,id,offset,limit);}
 @PostMapping("/{kind}/{id}/actions") public ObjectLifecycleService.Receipt act(Authentication a,@PathVariable(required=false) UUID tenant,@PathVariable String kind,@PathVariable UUID id,@Valid @RequestBody Action b){return service.act(actor(a),tenant,kind,id,b.requestId(),b.expectedRevision(),b.action(),b.irreversibleConfirmed());}
 @GetMapping("/technical") public List<ObjectLifecycleService.Technical> technical(Authentication a){return service.technical(actor(a));}
}
