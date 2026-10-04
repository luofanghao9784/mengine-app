package com.dreamcore.workspace.support;
import com.dreamcore.workspace.identity.PlatformIdentity;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/platform-admin/v1/support-access")
public class SupportController {
 private final SupportAccess access;private final PlatformIdentity identities;
 public SupportController(SupportAccess access,PlatformIdentity identities){this.access=access;this.identities=identities;}
 public record Enter(UUID tenant,String mode){}
 @PostMapping public SupportContext.Access enter(@RequestBody Enter b,HttpServletRequest q){var session=identities.read(q);try{return access.enter(session,b.tenant(),b.mode());}catch(com.dreamcore.workspace.identity.IdentityException e){access.enterDenied(session.actor(),b.tenant(),b.mode(),e.status);throw e;}}
 @GetMapping public Object visits(@RequestParam UUID tenant,@RequestParam(defaultValue="0") int offset){return access.visits(tenant,offset);}
 @GetMapping("/{id}") public SupportContext.Access read(@PathVariable UUID id,HttpServletRequest q){return access.read(id,identities.read(q).tokenHash());}
 @GetMapping("/{id}/records") public Object records(@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,HttpServletRequest q){return access.records(id,identities.read(q).tokenHash(),offset);}
 @DeleteMapping("/{id}") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void leave(@PathVariable UUID id,HttpServletRequest q){access.leave(id,identities.read(q));}
}
