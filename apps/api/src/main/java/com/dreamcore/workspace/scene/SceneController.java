package com.dreamcore.workspace.scene;
import java.util.*;
import jakarta.servlet.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class SceneController {
 private final SceneService scene;public SceneController(SceneService scene){this.scene=scene;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/scene-enterprises") public Object enterprises(Authentication a){return scene.bindings(actor(a));}
 @GetMapping({"/api/platform-admin/v1/tenants/{tenant}/scene/status","/api/tenant-admin/v1/tenants/{tenant}/scene/status"}) public Object status(Authentication a,@PathVariable UUID tenant,HttpServletRequest r){return scene.status(actor(a),tenant,r.getRequestURI().startsWith("/api/platform-admin/"));}
 @PostMapping({"/api/platform-admin/v1/tenants/{tenant}/scene/synchronize","/api/tenant-admin/v1/tenants/{tenant}/scene/synchronize"}) public Object sync(Authentication a,@PathVariable UUID tenant,HttpServletRequest r){return scene.synchronize(actor(a),tenant,r.getRequestURI().startsWith("/api/platform-admin/"));}
 @RequestMapping(value={"/api/platform-admin/v1/tenants/{tenant}/scene/dispatch","/api/tenant-admin/v1/tenants/{tenant}/scene/dispatch"},method={RequestMethod.GET,RequestMethod.POST})
 public Object dispatch(Authentication a,@PathVariable UUID tenant,@RequestParam String path,@RequestBody(required=false) Map<String,Object> body,HttpServletRequest r){return scene.dispatch(actor(a),tenant,r.getRequestURI().startsWith("/api/platform-admin/"),r.getMethod(),path,body);}
}
