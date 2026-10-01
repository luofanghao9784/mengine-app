package com.dreamcore.workspace.feedbackadjustment;
import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/feedback-adjustments")
public class FeedbackAdjustmentController {
 private final FeedbackAdjustmentService service;public FeedbackAdjustmentController(FeedbackAdjustmentService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public FeedbackAdjustmentService.View open(Authentication a,@PathVariable UUID tenant,@RequestParam String kind,@RequestParam(required=false) UUID taskId,@RequestParam int taskRevision,@RequestParam int attempt,@RequestParam String presentationVersion,@RequestParam int presentationRevision,@RequestParam(required=false) UUID publicationId,@RequestParam(required=false) UUID materialVersionId,@RequestParam(required=false) Integer materialVersion,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.open(UUID.fromString(a.getName()),tenant,new FeedbackService.Target(kind,taskId,taskRevision,attempt,presentationVersion,presentationRevision,publicationId,materialVersionId,materialVersion),offset,limit);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public FeedbackAdjustmentService.Sent send(Authentication a,@PathVariable UUID tenant,@RequestBody FeedbackAdjustmentService.Send b){return service.send(UUID.fromString(a.getName()),tenant,b);}
}
