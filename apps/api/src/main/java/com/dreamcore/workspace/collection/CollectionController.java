package com.dreamcore.workspace.collection;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/database")
public class CollectionController {
    private final CollectionService service;
    public CollectionController(CollectionService service){this.service=service;}
    public record Configure(@NotNull UUID requestId,@NotNull @Min(0) Long expectedRevision,@NotNull CollectionService.Schedule schedule){}
    public record Update(@NotNull UUID requestId,@NotNull @Min(0) Long expectedRevision){}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
    @GetMapping("/connections") public List<CollectionService.Connection> connections(Authentication auth,@PathVariable UUID tenant){return service.connections(actor(auth),tenant);}
    @GetMapping("/connections/{id}") public CollectionService.Connection connection(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.detail(actor(auth),tenant,id);}
    @GetMapping("/connections/{id}/runs") public List<CollectionService.Run> runs(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="21") int limit){return service.runs(actor(auth),tenant,id,offset,limit);}
    @PostMapping("/connections/{id}/schedule") public CollectionService.Connection configure(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Configure body){return service.configure(actor(auth),tenant,id,body.requestId(),body.expectedRevision(),body.schedule());}
    @PostMapping("/connections/{id}/update") public CollectionService.Run update(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Update body){return service.updateNow(actor(auth),tenant,id,body.requestId(),body.expectedRevision());}
    @GetMapping("/summary") public CollectionService.Summary summary(Authentication auth,@PathVariable UUID tenant){return service.summary(actor(auth),tenant);}
    @GetMapping("/datasets") public CollectionService.DataPage datasets(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="") String state,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.datasets(actor(auth),tenant,q,state,offset,limit);}
    @GetMapping("/datasets/{id}") public CollectionService.Preview preview(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.preview(actor(auth),tenant,id,offset,limit);}
}
