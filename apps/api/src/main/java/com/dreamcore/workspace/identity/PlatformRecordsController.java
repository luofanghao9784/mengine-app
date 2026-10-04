package com.dreamcore.workspace.identity;

import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1/records")
public class PlatformRecordsController {
    private final PlatformRecordsService service;
    public PlatformRecordsController(PlatformRecordsService service){this.service=service;}
    @GetMapping public List<PlatformRecordsService.Entry> list(Authentication auth,
        @RequestParam(defaultValue="") String category,@RequestParam(defaultValue="") String outcome,
        @RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="21") int limit) {
        return service.list(IdentityController.actor(auth),category,outcome,offset,limit);
    }
}
