package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import com.dreamcore.workspace.identity.IdentityException;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativeSkillsController {
 private final NativeEnterpriseSkills skills;public NativeSkillsController(NativeEnterpriseSkills s){skills=s;}
 @GetMapping("/api/v1/tenants/{tenant}/native-skills") public Object list(Authentication a,@PathVariable UUID tenant){return skills.list(UUID.fromString(a.getName()),tenant);}
 @GetMapping("/api/v1/tenants/{tenant}/admin/native-skills") public Object admin(Authentication a,@PathVariable UUID tenant){return skills.admin(UUID.fromString(a.getName()),tenant);}
 @PutMapping("/api/v1/tenants/{tenant}/admin/native-skills/{name}") public Object put(Authentication a,@PathVariable UUID tenant,@PathVariable String name,@RequestBody NativeEnterpriseSkills.Put body){return skills.put(UUID.fromString(a.getName()),tenant,name,body);}
 @PostMapping("/internal/v1/native-conversations/{id}/skills") public Object runtime(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String token,@RequestBody Map<String,Object> body){if(token==null||!token.startsWith("Bearer "))throw new IdentityException(403,"NATIVE_ACCESS_DENIED");if(!Set.of("name").containsAll(body.keySet())||body.containsKey("name")&&!(body.get("name") instanceof String))throw IdentityException.invalid();return skills.runtime(id,token.substring(7),(String)body.get("name"));}
}
