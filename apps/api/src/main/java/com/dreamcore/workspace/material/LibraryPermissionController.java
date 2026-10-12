package com.dreamcore.workspace.material;

import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/library-access")
public class LibraryPermissionController {
    private final LibraryPermissionService service;
    public LibraryPermissionController(LibraryPermissionService service){this.service=service;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @GetMapping("/status") public Map<String,Boolean> status(Authentication auth,@PathVariable UUID tenant){return Map.of("enabled",service.enabled(actor(auth),tenant));}
    @GetMapping("/{kind}/{id}") public LibraryPermissionService.Policy policy(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id){return service.policy(actor(auth),tenant,kind,id);}
    @PutMapping("/{kind}/{id}") public LibraryPermissionService.Policy save(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestBody LibraryPermissionService.Change change){return service.save(actor(auth),tenant,kind,id,change);}
    @GetMapping("/{kind}/{id}/events") public List<LibraryPermissionService.Event> events(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="OPERATIONS") String view){if(!Set.of("OPERATIONS","AUDIT").contains(view))throw com.dreamcore.workspace.identity.IdentityException.invalid();return service.events(actor(auth),tenant,kind,id,offset,view.equals("AUDIT"));}
    @GetMapping("/directory") public LibraryPermissionService.Directory directory(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID space){return service.directory(actor(auth),tenant,space);}
    @PutMapping("/departments/{id}") public LibraryPermissionService.Department department(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody LibraryPermissionService.DepartmentChange change){return service.saveDepartment(actor(auth),tenant,id,change);}
}
