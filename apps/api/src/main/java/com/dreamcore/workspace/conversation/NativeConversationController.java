package com.dreamcore.workspace.conversation;

import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import com.dreamcore.workspace.identity.IdentityException;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativeConversationController {
 private final NativeConversationService service; private final String webUrl;
 public NativeConversationController(NativeConversationService service,@org.springframework.beans.factory.annotation.Value("${dreamcore.native.web-url:}") String webUrl){this.service=service;this.webUrl=webUrl;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 private String token(String value){if(value==null||!value.startsWith("Bearer "))throw new IdentityException(403,"NATIVE_ACCESS_DENIED");return value.substring(7);}
 public record Query(String query){} public record Read(UUID materialId,UUID versionId){}
 /** Whether this deployment runs the native runtime; the UI keeps the entry hidden otherwise. */
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/availability") public Object availability(Authentication auth,@PathVariable UUID tenant){service.requireMember(actor(auth),tenant);return Map.of("enabled",!webUrl.isBlank());}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations") public Object list(Authentication auth,@PathVariable UUID tenant,@RequestParam UUID workspaceId){return service.list(actor(auth),tenant,workspaceId);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations") public Object open(Authentication auth,@PathVariable UUID tenant,@RequestBody NativeConversationService.Open body){return service.open(actor(auth),tenant,body);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/grant") public Object grant(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){if(webUrl.isBlank())throw new IdentityException(503,"NATIVE_RUNTIME_UNAVAILABLE");var grant=service.grant(actor(auth),tenant,id);return Map.of("session",grant.session(),"token",grant.token(),"expiresAt",grant.expiresAt(),"launchUrl",webUrl.replaceAll("/+$","")+"/launch");}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/stop") public Object stop(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.stop(actor(auth),tenant,id);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/resume") public Object resume(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.resume(actor(auth),tenant,id);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/artifacts") public Object artifacts(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.artifacts(actor(auth),tenant,id);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/publish") public Object publish(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody NativeConversationService.Publish body){return service.publish(actor(auth),tenant,id,body);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/artifacts/{artifact}") public ResponseEntity<byte[]> download(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable UUID artifact){
  var f=service.download(actor(auth),tenant,id,artifact);return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header("Content-Disposition",ContentDisposition.attachment().filename(f.filename(),java.nio.charset.StandardCharsets.UTF_8).build().toString()).body(f.bytes());
 }
 @PostMapping("/internal/v1/native-conversations/{id}/check") public Object check(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String auth){return service.check(id,token(auth));}
 @PostMapping("/internal/v1/native-conversations/{id}/history") public Object history(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String auth){return Map.of("context",service.history(id,token(auth)));}
 @PostMapping("/internal/v1/native-conversations/{id}/search") public Object search(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Query body){return service.search(id,token(auth),body.query());}
 @PostMapping("/internal/v1/native-conversations/{id}/read") public Object read(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Read body){var f=service.read(id,token(auth),body.materialId(),body.versionId());return Map.of("filename",f.filename(),"contentBase64",Base64.getEncoder().encodeToString(f.bytes()));}
 @PostMapping("/internal/v1/native-conversations/{id}/save") public Object save(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody NativeConversationService.Save body){return service.save(id,token(auth),body);}
}
