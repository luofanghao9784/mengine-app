package com.dreamcore.workspace.departure;
import jakarta.servlet.http.HttpServletResponse;import jakarta.validation.Valid;import jakarta.validation.constraints.*;import java.io.IOException;import java.util.*;import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;import org.springframework.http.*;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET) @RequestMapping("/api/v1/tenants/{tenant}/departure-exports")
public class DepartureArchiveController {
 public record Create(@NotNull UUID requestId,@NotNull UUID executionId,@NotNull UUID workspaceId,boolean includeHistory){}
 public record Next(@NotNull UUID requestId){}
 public record Command(@NotNull UUID requestId,@Min(1)int expectedRevision,@NotNull String action){}
 private final DepartureArchiveService service;public DepartureArchiveController(DepartureArchiveService service){this.service=service;}
 private UUID actor(Authentication a){return UUID.fromString(a.getName());}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @PostMapping @ResponseStatus(HttpStatus.CREATED)public DepartureArchiveService.Inventory create(Authentication a,@PathVariable UUID tenant,@Valid@RequestBody Create b){return service.create(actor(a),tenant,b.executionId(),b.workspaceId(),b.requestId(),b.includeHistory());}
 @GetMapping public DepartureArchiveService.Page<DepartureArchiveService.Inventory> list(Authentication a,@PathVariable UUID tenant,@RequestParam UUID executionId,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.list(actor(a),tenant,executionId,offset,limit);}
 @GetMapping("/cleanup")public DepartureArchiveService.Page<DepartureArchiveService.CleanupReceipt> receipts(Authentication a,@PathVariable UUID tenant,@RequestParam UUID executionId,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.receipts(actor(a),tenant,executionId,offset,limit);}
 @GetMapping("/{id}")public DepartureArchiveService.Inventory get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(actor(a),tenant,id);}
 @PostMapping("/{id}/parts")@ResponseStatus(HttpStatus.CREATED)public DepartureArchiveService.Part next(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid@RequestBody Next b){return service.next(actor(a),tenant,id,b.requestId());}
 @GetMapping("/{id}/parts")public DepartureArchiveService.Page<DepartureArchiveService.Part> parts(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit){return service.parts(actor(a),tenant,id,offset,limit);}
 @GetMapping("/parts/{id}")public DepartureArchiveService.Part part(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.part(actor(a),tenant,id);}
 @PostMapping("/parts/{id}")public DepartureArchiveService.Part command(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid@RequestBody Command b){return service.command(actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.action());}
 @GetMapping("/parts/{id}/cleanup")public DepartureArchiveService.CleanupReceipt receipt(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.receipt(actor(a),tenant,id);}
 @GetMapping("/parts/{id}/download")public void download(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,HttpServletResponse r)throws IOException{service.download(actor(a),tenant,id,info->{r.setContentType("application/zip");r.setContentLengthLong(info.bytes());r.setHeader("Content-Disposition",ContentDisposition.attachment().filename(info.filename()).build().toString());r.setHeader("X-Content-SHA256",info.sha256());},r.getOutputStream());}
}
