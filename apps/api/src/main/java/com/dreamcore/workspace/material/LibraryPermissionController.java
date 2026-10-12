package com.dreamcore.workspace.material;

import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/library-access")
public class LibraryPermissionController {
    private final LibraryPermissionService service;private final LibraryLaunchService launch;
    public LibraryPermissionController(LibraryPermissionService service,LibraryLaunchService launch){this.service=service;this.launch=launch;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @GetMapping("/status") public Map<String,Boolean> status(Authentication auth,@PathVariable UUID tenant){return Map.of("enabled",service.enabled(actor(auth),tenant));}
    @GetMapping("/{kind}/{id}") public LibraryPermissionService.Policy policy(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id){return service.policy(actor(auth),tenant,kind,id);}
    @PutMapping("/{kind}/{id}") public LibraryPermissionService.Policy save(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestBody LibraryLaunchService.Confirmation command){return launch.confirm(actor(auth),tenant,kind,id,command);}
    @GetMapping("/{kind}/{id}/events") public List<LibraryPermissionService.Event> events(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="OPERATIONS") String view){if(!Set.of("OPERATIONS","AUDIT").contains(view))throw com.dreamcore.workspace.identity.IdentityException.invalid();return service.events(actor(auth),tenant,kind,id,offset,view.equals("AUDIT"));}
    @PostMapping("/{kind}/{id}/preview") public LibraryLaunchService.Preview preview(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id,@RequestBody LibraryPermissionService.Change change){return launch.preview(actor(auth),tenant,kind,id,change);}
    @GetMapping("/{kind}/{id}/explanation") public LibraryLaunchService.Explanation explanation(Authentication auth,@PathVariable UUID tenant,@PathVariable String kind,@PathVariable UUID id){return launch.explain(actor(auth),tenant,kind,id);}
    @GetMapping("/locate") public LibraryLaunchService.Page locate(Authentication auth,@PathVariable UUID tenant,@RequestParam String mode,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="0") int offset){return launch.locate(actor(auth),tenant,mode,query,offset);}
    @GetMapping("/journal") public List<Map<String,Object>> journal(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset){return launch.journal(actor(auth),tenant,offset);}
    @GetMapping("/directory") public LibraryPermissionService.Directory directory(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID space){return service.directory(actor(auth),tenant,space);}
    @GetMapping("/departments/{id}/exceptions") public List<LibraryLaunchService.ExceptionGrant> exceptions(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return launch.departmentExceptions(actor(auth),tenant,id);}
    @PutMapping("/departments/{id}") public LibraryPermissionService.Department department(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody LibraryPermissionService.DepartmentChange change){return service.saveDepartment(actor(auth),tenant,id,change);}
}
