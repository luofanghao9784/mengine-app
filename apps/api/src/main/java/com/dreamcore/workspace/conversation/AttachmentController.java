package com.dreamcore.workspace.conversation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
@RestController @RequestMapping("/api/v1/tenants/{tenant}")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class AttachmentController {
 public record Upload(@NotNull UUID requestId,@NotNull UUID draftRequestId,UUID conversationId,UUID workspaceId) {}
 public record Save(@NotNull UUID requestId) {}
 private final ConversationAttachments service;
 public AttachmentController(ConversationAttachments service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @PostMapping(value="/conversation-attachments",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @ResponseStatus(HttpStatus.CREATED)
 public ConversationAttachments.Receipt upload(Authentication auth,@PathVariable UUID tenant,@Valid @RequestPart("metadata") Upload metadata,@RequestPart("file") MultipartFile file){return service.upload(UUID.fromString(auth.getName()),tenant,metadata.conversationId(),metadata.draftRequestId(),metadata.requestId(),file,metadata.workspaceId());}
 @GetMapping("/conversation-attachments/drafts/{request}") public Object draft(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID request){return java.util.Collections.singletonMap("conversation",service.draft(UUID.fromString(auth.getName()),tenant,request));}
 @GetMapping("/conversations/{conversation}/attachments") public Object list(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation){return service.list(UUID.fromString(auth.getName()),tenant,conversation);}
 @PostMapping("/conversations/{conversation}/attachments/{material}/save") public Object save(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID material,@Valid @RequestBody Save body){return service.save(UUID.fromString(auth.getName()),tenant,conversation,material,body.requestId());}
}
