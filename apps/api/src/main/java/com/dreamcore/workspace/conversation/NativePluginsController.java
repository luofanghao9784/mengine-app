package com.dreamcore.workspace.conversation;
import java.util.*;import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;import com.dreamcore.workspace.identity.IdentityException;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativePluginsController {
 private final NativePluginPolicy plugins;private final NativeConversationService sessions;
 public NativePluginsController(NativePluginPolicy p,NativeConversationService s){plugins=p;sessions=s;}
 @GetMapping("/api/v1/tenants/{tenant}/native-plugins") public Object list(Authentication a,@PathVariable UUID tenant){return plugins.list(UUID.fromString(a.getName()),tenant,false);}
 @GetMapping("/api/v1/tenants/{tenant}/admin/native-plugins") public Object admin(Authentication a,@PathVariable UUID tenant){return plugins.list(UUID.fromString(a.getName()),tenant,true);}
 @PutMapping("/api/v1/tenants/{tenant}/admin/native-plugins/{id}") public Object toggle(Authentication a,@PathVariable UUID tenant,@PathVariable String id,@RequestBody NativePluginPolicy.Toggle body){return plugins.toggle(UUID.fromString(a.getName()),tenant,id,body);}
 @PostMapping("/internal/v1/native-conversations/{id}/runtime-config") public Object config(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String token){if(token==null||!token.startsWith("Bearer "))throw new IdentityException(403,"NATIVE_ACCESS_DENIED");var s=sessions.check(id,token.substring(7));return Map.of("scope",s,"plugins",plugins.snapshot(s.tenantId()));}
}
