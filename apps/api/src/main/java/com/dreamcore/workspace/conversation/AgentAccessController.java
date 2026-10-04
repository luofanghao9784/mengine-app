package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/internal/v1/agent-access/{task}")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class AgentAccessController {
    public record Query(String query) {}
    public record Original(UUID versionId) {}
    private final AgentTaskService service;private final AgentUsageLedger usage;public AgentAccessController(AgentTaskService service,AgentUsageLedger usage){this.service=service;this.usage=usage;}
    private UUID attempt(String header){try{if(header==null || !header.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(header.substring(7));}catch(Exception error){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
    @PostMapping("/check") public ResponseEntity<?> check(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.check(task,attempt(auth)));}
    @PostMapping("/execution/open") public ResponseEntity<?> openExecution(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody AgentTaskService.ExecutionOpen body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.openExecution(task,attempt(auth),body));}
    @PostMapping("/execution/tool") public ResponseEntity<?> toolReceipt(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody AgentTaskService.ToolReceipt body){service.toolReceipt(task,attempt(auth),body);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("accepted",true));}
    @PostMapping("/model-usage/open") public ResponseEntity<?> openUsage(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.openUsage(task,attempt(auth)));}
    @PostMapping("/model-usage/start") public ResponseEntity<?> startUsage(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody AgentUsageLedger.Start body){service.startUsage(task,attempt(auth),body);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("accepted",true));}
    @PostMapping("/model-usage/finish") public ResponseEntity<?> finishUsage(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody AgentUsageLedger.Receipt body){usage.finish(task,attempt(auth),body);return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("accepted",true));}
    @PostMapping("/search") public ResponseEntity<?> search(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Query body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.searchResult(task,attempt(auth),body.query()));}
    @PostMapping("/compare-dataset") public ResponseEntity<?> compareDataset(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody DatasetCalculationService.Request body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.compareDataset(task,attempt(auth),body));}
    @PostMapping("/compare-table") public ResponseEntity<?> compareTable(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody TableCalculationService.Request body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.compareTable(task,attempt(auth),body));}
    @PostMapping("/deliver-briefing") public ResponseEntity<?> deliverBriefing(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody BriefingContentService.Request body){try { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.deliverBriefing(task,attempt(auth),body)); } catch(com.dreamcore.workspace.identity.IdentityException error) { org.slf4j.LoggerFactory.getLogger(AgentAccessController.class).warn("Briefing rejected task={} code={}",task,error.code); throw error; }}
    @PostMapping("/originals") public ResponseEntity<?> originals(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("items",service.originals(task,attempt(auth))));}
    @PostMapping("/read-original") public ResponseEntity<?> readOriginal(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Original body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.readOriginal(task,attempt(auth),body.versionId()));}
}
