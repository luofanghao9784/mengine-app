package com.dreamcore.workspace.conversation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.http.*;
import java.nio.charset.StandardCharsets;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/tenants/{tenant}/conversations")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class ConversationController {
    public record Send(@NotNull UUID requestId,UUID workspaceId,@NotNull String prompt,@NotNull String mode,@Size(max=2048) String publicQuery,@Size(max=3) java.util.List<TaskOriginals.Selection> originals,String sourceScope,@Valid ConversationService.BriefingReference briefingContext) {}
    public record Action(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull String action,@Size(max=2000) String input,@Size(max=3) java.util.List<TaskOriginals.Selection> originals) {}
    public record Management(@NotNull UUID requestId,@Min(0) int expectedRevision,@NotNull String action,boolean stopRunning) {}
    public record Read(@Min(0) long replyRevision) {}
    private final ConversationManagement management;
    private final ConversationService service;private final AgentTaskService agents;private final ConversationTitles titles;public ConversationController(ConversationService service,AgentTaskService agents,ConversationTitles titles,ConversationManagement management){this.service=service;this.agents=agents;this.titles=titles;this.management=management;}
    private void title(UUID actor,UUID tenant,UUID conversation){try{titles.request(actor,tenant,conversation);}catch(RuntimeException ignored){/* Metadata must never fail a submitted task or readable reply. */}}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void privateResponse(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public ConversationService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,offset,limit);}
    @GetMapping("/trash") public ConversationService.Page trash(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,offset,limit,true);}
    @PostMapping("/{conversation}/management") public ConversationManagement.Receipt manage(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@Valid @RequestBody Management body){return management.action(actor(auth),tenant,conversation,body.requestId(),body.expectedRevision(),body.action(),body.stopRunning());}
    @PostMapping("/{conversation}/read") public ConversationManagement.ReadReceipt read(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@Valid @RequestBody Read body){return management.read(actor(auth),tenant,conversation,body.replyRevision());}
    @GetMapping("/{conversation}") public ConversationService.Detail detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){var result=service.detail(actor(auth),tenant,conversation,offset,limit);title(actor(auth),tenant,conversation);return result;}
    @GetMapping("/{conversation}/tasks/{task}") public ConversationService.Detail taskDetail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task){return service.taskDetail(actor(auth),tenant,conversation,task);}
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED) public ConversationService.Detail create(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Send body){return submit(auth,tenant,null,body);}
    @PostMapping("/{conversation}/tasks") @ResponseStatus(HttpStatus.ACCEPTED) public ConversationService.Detail send(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@Valid @RequestBody Send body){return submit(auth,tenant,conversation,body);}
    private ConversationService.Detail submit(Authentication auth,UUID tenant,UUID conversation,Send body){
        if(body.briefingContext()!=null)return agents.sendDiscussion(actor(auth),tenant,conversation,body.briefingContext(),body.workspaceId(),body.requestId(),body.prompt(),body.mode(),body.publicQuery(),body.originals(),body.sourceScope());
        var result=service.submitClient(actor(auth),tenant,conversation,body.workspaceId(),body.requestId(),body.prompt(),body.mode(),body.publicQuery(),body.originals(),body.sourceScope());
        title(actor(auth),tenant,result.conversation().id());return result;
    }
    @PostMapping("/{conversation}/tasks/{task}") public ConversationService.Detail action(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@Valid @RequestBody Action body){return service.action(actor(auth),tenant,conversation,task,body.requestId(),body.expectedRevision(),body.action(),body.input(),body.originals());}
    @GetMapping("/{conversation}/tasks/{task}/attempts") public ConversationService.Attempts attempts(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="10") int limit){return service.attempts(actor(auth),tenant,conversation,task,offset,limit);}
    @GetMapping("/{conversation}/tasks/{task}/briefing") public BriefingContentService.Document briefing(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@RequestParam int revision,@RequestParam int attempt){return agents.briefing(actor(auth),tenant,conversation,task,revision,attempt);}
    @RequestMapping(value="/{conversation}/tasks/{task}/discussion",method={RequestMethod.GET,RequestMethod.POST}) public AgentTaskService.Discussion discussion(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@RequestParam int revision,@RequestParam int attempt){return agents.discussion(actor(auth),tenant,conversation,task,revision,attempt);}
    @GetMapping("/{conversation}/events") public ConversationService.Events events(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@RequestParam(defaultValue="0") long after){return service.events(actor(auth),tenant,conversation,after);}
    @GetMapping("/{conversation}/tasks/{task}/artifacts/{artifact}") public ResponseEntity<byte[]> artifact(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,@PathVariable UUID artifact){
        var file=agents.download(actor(auth),tenant,conversation,task,artifact);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).cacheControl(CacheControl.noStore()).header("Content-Disposition",ContentDisposition.attachment().filename(file.filename(),StandardCharsets.UTF_8).build().toString()).header("X-Content-SHA256",file.sha256()).body(file.bytes());
    }
}
