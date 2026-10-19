package com.dreamcore.workspace.scene;

import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletResponse;

@RestController
public class FoundationProcessingController {
 private final FoundationProcessingService service;
 public FoundationProcessingController(FoundationProcessingService service){this.service=service;}
 @GetMapping("/api/v1/tenants/{tenant}/foundation/assets/{asset}/processing")
 public Object read(Authentication auth,@PathVariable UUID tenant,@PathVariable String asset,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit,@RequestParam(required=false) String revision,HttpServletResponse response){
  response.setHeader("Cache-Control","private, no-store");
  return service.read(UUID.fromString(auth.getName()),tenant,asset,offset,limit,revision);
 }
}
