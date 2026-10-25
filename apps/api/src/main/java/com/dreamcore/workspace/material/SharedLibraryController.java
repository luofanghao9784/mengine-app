package com.dreamcore.workspace.material;

import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@ConditionalOnWebApplication(type = Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/shared-library")
public class SharedLibraryController {
   private final SharedLibraryService service;
   private final SharedLibraryLifecycleService lifecycle;

   public SharedLibraryController(SharedLibraryService service, SharedLibraryLifecycleService lifecycle) {
      this.service = service;
      this.lifecycle = lifecycle;
   }

   @GetMapping
   public SharedLibraryService.Setup setup(Authentication auth, @PathVariable UUID tenant) {
      return this.service.setup(UUID.fromString(auth.getName()), tenant);
   }

   @PostMapping(consumes = "multipart/form-data")
   @ResponseStatus(HttpStatus.CREATED)
   public SharedLibraryService.Result create(
      Authentication auth,
      @PathVariable UUID tenant,
      @RequestPart("metadata") SharedLibraryService.Command command,
      @RequestPart(value = "files", required = false) List<MultipartFile> files
   ) {
      return this.service.create(UUID.fromString(auth.getName()), tenant, command, files == null ? List.of() : files);
   }

   @GetMapping("/spaces")
   public List<SharedLibraryLifecycleService.Space> spaces(Authentication auth, @PathVariable UUID tenant) {
      return this.lifecycle.list(UUID.fromString(auth.getName()), tenant);
   }

   @GetMapping("/spaces/{id}")
   public SharedLibraryLifecycleService.Preview preview(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID id) {
      return this.lifecycle.preview(UUID.fromString(auth.getName()), tenant, id);
   }

   @PostMapping("/spaces/{id}/deletion")
   public SharedLibraryLifecycleService.Preview deletion(
      Authentication auth, @PathVariable UUID tenant, @PathVariable UUID id, @RequestBody SharedLibraryLifecycleService.Change change
   ) {
      return this.lifecycle.change(UUID.fromString(auth.getName()), tenant, id, change);
   }
}
