package com.dreamcore.workspace.collection;
import java.util.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/database/lifecycle")
public class DatasetLifecycleController {
 private final DatasetLifecycleService service;
 public DatasetLifecycleController(DatasetLifecycleService service){this.service=service;}
 public record Action(@NotNull UUID requestId,@Min(0) long expectedRevision,@NotNull String action,boolean confirmed){}
 @GetMapping public List<DatasetLifecycleService.Item> records(Authentication a,@PathVariable UUID tenant){return service.records(UUID.fromString(a.getName()),tenant);}
 @GetMapping("/{id}") public DatasetLifecycleService.Item get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(UUID.fromString(a.getName()),tenant,id);}
 @PostMapping("/{id}") public DatasetLifecycleService.Item act(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Action b){return service.act(UUID.fromString(a.getName()),tenant,id,b.requestId(),b.expectedRevision(),b.action(),b.confirmed());}
}
