package com.dreamcore.workspace.source;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/workspaces/{workspace}/sources")
public class SourceController {
    public record Create(@NotNull UUID requestId,@NotNull SourceService.Settings settings) {}
    public record Edit(@NotNull UUID requestId,@NotNull Integer expectedRevision,@NotNull SourceService.Settings settings) {}
    public record Submit(@NotNull UUID requestId,@NotNull LocalDate coverageFrom,@NotNull LocalDate coverageThrough,@NotNull String note,@NotNull List<UUID> versionIds) {}
    public record Withdraw(@NotNull UUID requestId,@NotNull Integer expectedRevision) {}
    private final SourceService sources;
    public SourceController(SourceService sources){this.sources=sources;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public SourceService.Page list(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return sources.list(actor(auth),tenant,workspace,offset,limit);}
    @GetMapping("/{source}") public SourceService.Source get(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source){return sources.get(actor(auth),tenant,workspace,source);}
    @GetMapping("/{source}/versions") public SourceService.ConfigHistory history(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return sources.history(actor(auth),tenant,workspace,source,offset,limit);}
    @PostMapping @ResponseStatus(HttpStatus.CREATED) public SourceService.Source create(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@Valid @RequestBody Create body){return sources.create(actor(auth),tenant,workspace,body.requestId(),body.settings());}
    @PostMapping("/{source}") public SourceService.Source edit(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source,@Valid @RequestBody Edit body){return sources.update(actor(auth),tenant,workspace,source,body.requestId(),body.expectedRevision(),body.settings());}
    @GetMapping("/{source}/submissions") public SourceService.Submissions submissions(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="50") int limit){return sources.submissions(actor(auth),tenant,workspace,source,offset,limit);}
    @PostMapping("/{source}/submissions") @ResponseStatus(HttpStatus.CREATED) public SourceService.Submission submit(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source,@Valid @RequestBody Submit body){return sources.submit(actor(auth),tenant,workspace,source,body.requestId(),body.coverageFrom(),body.coverageThrough(),body.note(),body.versionIds());}
    @PostMapping("/{source}/submissions/{submission}/withdraw") public SourceService.Submission withdraw(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID source,@PathVariable UUID submission,@Valid @RequestBody Withdraw body){return sources.withdraw(actor(auth),tenant,workspace,source,submission,body.requestId(),body.expectedRevision());}
}
