package com.dreamcore.workspace.export;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/export-batches")
public class ExportBatchController {
 public record Create(@NotNull UUID requestId,@NotNull UUID workspaceId,@NotNull String scope,@Min(1) @Max(7) int retentionDays,@NotNull @Size(min=1,max=50) List<ExportSources.Selection> items) {}
 public record Command(@NotNull UUID requestId,@Min(1)int expectedRevision,@NotNull String action) {}
 private final ExportBatchService service;public ExportBatchController(ExportBatchService service){this.service=service;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping("/options") public ExportSources.Options options(Authentication a,@PathVariable UUID tenant,@RequestParam UUID workspaceId,@RequestParam String scope,@RequestParam(required=false) UUID objectId,@RequestParam(defaultValue="docx") String format,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.options(actor(a),tenant,workspaceId,scope,objectId,format,offset,limit);}
 @GetMapping public ExportBatchService.Page list(Authentication a,@PathVariable UUID tenant,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit,@RequestParam(required=false)UUID workspaceId){return service.list(actor(a),tenant,offset,limit,workspaceId);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public ExportBatchService.Batch create(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Create b){return service.create(actor(a),tenant,b.workspaceId(),b.scope(),b.requestId(),b.retentionDays(),b.items());}
 @GetMapping("/{id}")public ExportBatchService.Batch get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(actor(a),tenant,id);}
 @PostMapping("/{id}")public ExportBatchService.Batch command(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Command b){return service.command(actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.action());}
 @GetMapping("/{id}/archive")public void archive(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,HttpServletResponse response)throws IOException{service.download(actor(a),tenant,id,info->{response.setContentType("application/zip");response.setContentLengthLong(info.bytes());response.setHeader("X-Content-SHA256",info.sha256());response.setHeader("Content-Disposition",ContentDisposition.attachment().filename(info.filename()).build().toString());},response.getOutputStream());}
}
