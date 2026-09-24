package com.dreamcore.workspace.document;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/tenants/{tenant}/documents")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class DocumentController {
    public record Create(@NotNull UUID requestId,@NotNull UUID conversationId,@NotNull UUID taskId,UUID artifactId) {}
    public record Save(@NotNull UUID requestId,@NotNull @Min(1) Integer expectedRevision,@NotNull @Size(max=160) String title,@NotNull @Size(max=32768) String body) {}
    public record Publish(@NotNull UUID requestId,@NotNull UUID workspaceId,UUID folderId,UUID materialId,@Min(1) Integer expectedMaterialVersion,@NotNull String format,@NotNull @AssertTrue Boolean acknowledgeIndependentCopy) {}
    private final DocumentService service;private final DocumentPublicationService publications;
    public DocumentController(DocumentService service,DocumentPublicationService publications){this.service=service;this.publications=publications;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void privateResponse(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public DocumentService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,offset,limit);}
    @PostMapping public DocumentService.Detail create(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Create body){return service.create(actor(auth),tenant,body.conversationId(),body.taskId(),body.artifactId(),body.requestId());}
    @GetMapping("/{id}/publications") public DocumentPublicationService.Page publications(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return publications.list(actor(auth),tenant,id,offset,limit);}
    @PostMapping("/{id}/versions/{version}/publications") public DocumentPublicationService.Publication publish(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable int version,@Valid @RequestBody Publish body){return publications.publish(actor(auth),tenant,id,version,body.requestId(),body.workspaceId(),body.folderId(),body.materialId(),body.expectedMaterialVersion(),body.format(),body.acknowledgeIndependentCopy());}
    @GetMapping("/{id}") public DocumentService.Detail detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(required=false) Integer version){return service.detail(actor(auth),tenant,id,version);}
    @PostMapping("/{id}/versions") public DocumentService.Detail save(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Save body){return service.save(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.title(),body.body());}
    @GetMapping("/{id}/versions/{version}/exports/{format}") public ResponseEntity<byte[]> export(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable int version,@PathVariable String format){var file=service.export(actor(auth),tenant,id,version,format);return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.contentType())).contentLength(file.bytes().length).header("Content-Disposition",ContentDisposition.attachment().filename(file.filename()).build().toString()).header("X-Content-SHA256",file.sha256()).body(file.bytes());}
}
