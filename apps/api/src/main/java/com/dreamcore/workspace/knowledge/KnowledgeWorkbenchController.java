package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/knowledge/workbench")
public class KnowledgeWorkbenchController {
 private final KnowledgeWorkbenchService service;
 public KnowledgeWorkbenchController(KnowledgeWorkbenchService service){this.service=service;}
 @GetMapping public KnowledgeWorkbenchService.Snapshot read(Authentication auth,@PathVariable UUID tenant,
  @RequestParam(defaultValue="ALL") String state,@RequestParam(required=false) UUID workspace,
  @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="0") int offset,HttpServletResponse response){
  response.setHeader("Cache-Control","private, no-store");
  return service.read(UUID.fromString(auth.getName()),tenant,state,workspace,q,offset);
 }
}
