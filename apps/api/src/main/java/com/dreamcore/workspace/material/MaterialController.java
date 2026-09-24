package com.dreamcore.workspace.material;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}")
public class MaterialController {
    public record FolderRequest(@NotNull UUID requestId, UUID parentId, @NotNull String name) {}
    public record UploadRequest(@NotNull UUID requestId, UUID folderId, Integer expectedVersion) {}
    private final MaterialService service;
    public MaterialController(MaterialService service) { this.service=service; }
    private UUID actor(Authentication auth) { return UUID.fromString(auth.getName()); }
    @ModelAttribute public void privateResponse(HttpServletResponse response) {
        response.setHeader("Cache-Control","private, no-store"); response.setHeader("X-Content-Type-Options","nosniff");
    }
    @GetMapping("/library")
    public MaterialService.Page enterprise(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="") String q,
            @RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit) {
        return service.list(actor(auth),tenant,null,null,q,offset,limit);
    }
    @GetMapping("/workspaces/{workspace}/library")
    public MaterialService.Page list(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@RequestParam(required=false) UUID folder,
            @RequestParam(defaultValue="") String q,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit) {
        return service.list(actor(auth),tenant,workspace,folder,q,offset,limit);
    }
    @PostMapping("/workspaces/{workspace}/folders") @ResponseStatus(HttpStatus.CREATED)
    public MaterialService.Crumb folder(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@Valid @RequestBody FolderRequest body) {
        return service.createFolder(actor(auth),tenant,workspace,body.parentId(),body.name(),body.requestId());
    }
    @PostMapping(value="/workspaces/{workspace}/materials",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @ResponseStatus(HttpStatus.CREATED)
    public MaterialService.Entry upload(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,
            @Valid @RequestPart("metadata") UploadRequest metadata,@RequestPart("file") MultipartFile file) {
        return service.upload(actor(auth),tenant,workspace,metadata.folderId(),null,metadata.expectedVersion(),metadata.requestId(),file);
    }
    @PostMapping(value="/workspaces/{workspace}/materials/{material}/versions",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @ResponseStatus(HttpStatus.CREATED)
    public MaterialService.Entry version(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID material,
            @Valid @RequestPart("metadata") UploadRequest metadata,@RequestPart("file") MultipartFile file) {
        return service.upload(actor(auth),tenant,workspace,metadata.folderId(),material,metadata.expectedVersion(),metadata.requestId(),file);
    }
    @GetMapping("/workspaces/{workspace}/materials/{material}")
    public MaterialService.Detail detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID material,
            @RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit) {
        return service.detail(actor(auth),tenant,workspace,material,offset,limit);
    }
    @GetMapping("/workspaces/{workspace}/materials/{material}/versions/{version}/download")
    public ResponseEntity<byte[]> download(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID material,@PathVariable UUID version) {
        var result=service.download(actor(auth),tenant,workspace,material,version);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).contentLength(result.bytes().length)
            .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(result.filename(),StandardCharsets.UTF_8).build().toString())
            .header("Content-Security-Policy","sandbox; default-src 'none'").body(result.bytes());
    }
}
