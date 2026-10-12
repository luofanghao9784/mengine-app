package com.dreamcore.workspace.material;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/workspaces/{space}/library-moves/{kind}/{id}")
public class LibraryMoveController {
 private final LibraryMoveService service;
 public LibraryMoveController(LibraryMoveService service){this.service=service;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @GetMapping("/destinations") public List<LibraryMoveService.Destination> destinations(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable String kind,@PathVariable UUID id){return service.destinations(actor(a),tenant,space,kind,id);}
 @PostMapping("/preview") public LibraryMoveService.Preview preview(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable String kind,@PathVariable UUID id,@RequestBody LibraryMoveService.Proposal p){return service.preview(actor(a),tenant,space,kind,id,p);}
 @PostMapping public LibraryMoveService.Receipt move(Authentication a,@PathVariable UUID tenant,@PathVariable UUID space,@PathVariable String kind,@PathVariable UUID id,@RequestBody LibraryMoveService.Commit c){return service.move(actor(a),tenant,space,kind,id,c);}
}
