package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.dreamcore.workspace.identity.IdentityException;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativeAttachmentsController {
 private final NativeAttachments files;public NativeAttachmentsController(NativeAttachments f){files=f;}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/attachments") public Object upload(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam UUID requestId,@RequestPart MultipartFile file){return files.upload(UUID.fromString(a.getName()),tenant,id,requestId,file);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/attachments") public Object list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return files.list(UUID.fromString(a.getName()),tenant,id);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{id}/attachments/{attachment}") public ResponseEntity<byte[]> download(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@PathVariable UUID attachment){var f=files.download(UUID.fromString(a.getName()),tenant,id,attachment);return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header("Content-Disposition",ContentDisposition.attachment().filename(f.filename(),java.nio.charset.StandardCharsets.UTF_8).build().toString()).body(f.bytes());}
 public record Read(UUID attachmentId){}
 @PostMapping("/internal/v1/native-conversations/{id}/attachment-read") public Object read(@PathVariable UUID id,@RequestHeader(value="Authorization",required=false) String token,@RequestBody Read body){if(token==null||!token.startsWith("Bearer "))throw new IdentityException(403,"NATIVE_ACCESS_DENIED");return files.runtime(id,token.substring(7),body.attachmentId());}
}
