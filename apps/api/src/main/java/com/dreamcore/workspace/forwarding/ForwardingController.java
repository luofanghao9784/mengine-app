package com.dreamcore.workspace.forwarding;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/tenants/{tenant}/forwarding")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class ForwardingController {
 public record Open(UUID requestId) {}
 private final ForwardingService service;public ForwardingController(ForwardingService service){this.service=service;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 private ResponseEntity<?> read(Object body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
 @GetMapping("/recipients") public ResponseEntity<?> recipients(Authentication auth,@PathVariable UUID tenant,@RequestParam UUID publicationId,@RequestParam UUID materialVersionId,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return read(service.recipients(actor(auth),tenant,publicationId,materialVersionId,query,offset,limit));}
 @PostMapping("/batches") public ResponseEntity<?> send(Authentication auth,@PathVariable UUID tenant,@RequestBody ForwardingService.Send body){return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(service.send(actor(auth),tenant,body));}
 @GetMapping("/batches/{batch}") public ResponseEntity<?> batch(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID batch){return read(service.batch(actor(auth),tenant,batch));}
 @GetMapping("/batches") public ResponseEntity<?> history(Authentication auth,@PathVariable UUID tenant,@RequestParam UUID publicationId,@RequestParam UUID materialVersionId,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="10") int limit){return read(service.history(actor(auth),tenant,publicationId,materialVersionId,offset,limit));}
 @GetMapping("/inbox") public ResponseEntity<?> inbox(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return read(service.inbox(actor(auth),tenant,offset,limit));}
 @PostMapping("/inbox/{receipt}/open") public ResponseEntity<?> open(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID receipt,@RequestBody Open body){return read(service.open(actor(auth),tenant,receipt,body==null?null:body.requestId()));}
}
