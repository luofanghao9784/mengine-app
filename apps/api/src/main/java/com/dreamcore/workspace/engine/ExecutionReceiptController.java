package com.dreamcore.workspace.engine;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
@RestController @RequestMapping("/internal/v1/engine-receipts")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class ExecutionReceiptController {
 private final ExecutionReceipts receipts;private final String token;
 public ExecutionReceiptController(ExecutionReceipts receipts,@Value("${dreamcore.tasks.engine-token:}") String token){this.receipts=receipts;this.token=token;}
 private void authenticate(String header){if(token.length()<32||header==null||!MessageDigest.isEqual(("Bearer "+token).getBytes(StandardCharsets.UTF_8),header.getBytes(StandardCharsets.UTF_8)))throw new IdentityException(403,"EXECUTION_RECEIPT_DENIED");}
 @PostMapping("/{kind}/{task}/{attempt}/claim") public Object claim(@RequestHeader(value="Authorization",required=false) String auth,@PathVariable String kind,@PathVariable UUID task,@PathVariable UUID attempt,@RequestBody ExecutionReceipts.Claim body){authenticate(auth);return receipts.claim(kind,task,attempt,body);}
 @PostMapping("/{kind}/{task}/{attempt}/finish") public Object finish(@RequestHeader(value="Authorization",required=false) String auth,@PathVariable String kind,@PathVariable UUID task,@PathVariable UUID attempt,@RequestBody ExecutionReceipts.Finish body){authenticate(auth);receipts.finish(kind,task,attempt,body);return Map.of("accepted",true);}
}
