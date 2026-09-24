package com.dreamcore.workspace.identity;

import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice(assignableTypes = {IdentityController.class, PlatformAdminController.class, TenantAdminController.class, OperationsController.class, com.dreamcore.workspace.material.MaterialController.class, com.dreamcore.workspace.knowledge.KnowledgeController.class, com.dreamcore.workspace.conversation.ConversationController.class, com.dreamcore.workspace.conversation.AgentAccessController.class, com.dreamcore.workspace.briefing.BriefingController.class, com.dreamcore.workspace.document.DocumentController.class, com.dreamcore.workspace.activity.ActivityController.class})
public class IdentityErrors {
    @ExceptionHandler(IdentityException.class)
    ResponseEntity<?> identity(IdentityException error) { return response(error.status,error.code); }
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class,MethodArgumentTypeMismatchException.class})
    ResponseEntity<?> invalid() { return response(400,"INVALID_REQUEST"); }
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<?> tooLarge() { return response(413,"MATERIAL_TOO_LARGE"); }
    @ExceptionHandler({org.springframework.web.multipart.support.MissingServletRequestPartException.class, org.springframework.web.bind.MissingServletRequestParameterException.class})
    ResponseEntity<?> missingPart() { return response(400,"INVALID_REQUEST"); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> conflict() { return response(409,"STATE_CONFLICT"); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<?> failure() { return response(500,"INTERNAL_ERROR"); }
    private ResponseEntity<?> response(int status, String code) {
        return ResponseEntity.status(status).header("Cache-Control","no-store")
                .body(Map.of("contractVersion","1.0","code",code,"message","请求未完成，请检查输入或当前状态。","retryable",status>=500));
    }
}
