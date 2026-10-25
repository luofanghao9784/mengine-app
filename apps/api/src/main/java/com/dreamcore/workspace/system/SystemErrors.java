package com.dreamcore.workspace.system;

import com.dreamcore.workspace.engine.EngineGateway;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ResponseEntity.BodyBuilder;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(-100)
@RestControllerAdvice(assignableTypes = SystemController.class)
class SystemErrors {
   @ExceptionHandler(EngineGateway.Unavailable.class)
   ResponseEntity<SystemErrors.ErrorBody> unavailable() {
      return this.error(HttpStatus.SERVICE_UNAVAILABLE, "ENGINE_UNAVAILABLE", "引擎暂不可用，请稍后重试。", true);
   }

   @ExceptionHandler(EngineGateway.Incompatible.class)
   ResponseEntity<SystemErrors.ErrorBody> incompatible() {
      return this.error(HttpStatus.BAD_GATEWAY, "ENGINE_INCOMPATIBLE", "引擎契约与平台不兼容。", false);
   }

   private ResponseEntity<SystemErrors.ErrorBody> error(HttpStatus status, String code, String message, boolean retryable) {
      return ((BodyBuilder)ResponseEntity.status(status).header("Cache-Control", new String[]{"no-store"}))
         .body(new SystemErrors.ErrorBody("1.0", code, message, retryable));
   }

   record ErrorBody(String contractVersion, String code, String message, boolean retryable) {
   }
}
