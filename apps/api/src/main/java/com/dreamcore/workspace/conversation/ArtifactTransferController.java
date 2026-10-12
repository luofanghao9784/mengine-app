package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/internal/v1/agent-access/{task}/artifacts")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class ArtifactTransferController {
    private final ArtifactTransferService transfers;
    public ArtifactTransferController(ArtifactTransferService transfers){this.transfers=transfers;}
    private UUID attempt(String header){try{if(header==null || !header.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(header.substring(7));}catch(Exception error){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
    private ResponseEntity<?> response(Object value){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);}
    @PostMapping("/prepare") public ResponseEntity<?> prepare(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ArtifactTransferService.Prepare body){return response(transfers.prepare(task,attempt(auth),body));}
    @PostMapping("/{upload}/chunk") public ResponseEntity<?> chunk(@PathVariable UUID task,@PathVariable UUID upload,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ArtifactTransferService.Chunk body){return response(transfers.chunk(task,attempt(auth),upload,body));}
    @PostMapping("/{upload}/complete") public ResponseEntity<?> complete(@PathVariable UUID task,@PathVariable UUID upload,@RequestHeader(value="Authorization",required=false) String auth){return response(transfers.complete(task,attempt(auth),upload));}
}
