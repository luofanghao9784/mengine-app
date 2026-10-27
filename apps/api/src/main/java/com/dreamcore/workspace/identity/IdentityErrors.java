package com.dreamcore.workspace.identity;

import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice(basePackages = "com.dreamcore.workspace")
public class IdentityErrors {
    private static final Logger LOG = LoggerFactory.getLogger(IdentityErrors.class);
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
    ResponseEntity<?> failure(Exception error) {
        String errorId = UUID.randomUUID().toString();
        // Throwable messages may contain SQL, credentials or business values.
        // Deliberately log only bounded types and application code locations.
        LOG.error("Unexpected API error errorId={} causes={}", errorId, diagnostic(error));
        return ResponseEntity.status(500).header("Cache-Control","no-store").header("X-Error-ID",errorId)
            .body(Map.of("contractVersion","1.0","code","INTERNAL_ERROR","message","请求未完成，请检查输入或当前状态。","retryable",true,"errorId",errorId));
    }
    private static String diagnostic(Throwable error) {
        var detail = new StringBuilder();
        for(int depth=0; error!=null && depth<4; depth++,error=error.getCause()) {
            if(depth>0)detail.append(" <- ");
            detail.append(error.getClass().getName());
            int frames=0;
            for(var frame:error.getStackTrace()) {
                if(frame.getClassName().startsWith("com.dreamcore.workspace.") && frames++<8)
                    detail.append(" at ").append(frame.getClassName()).append('.').append(frame.getMethodName()).append(':').append(frame.getLineNumber());
            }
        }
        return detail.toString();
    }
    private ResponseEntity<?> response(int status, String code) {
        return ResponseEntity.status(status).header("Cache-Control","no-store")
                .body(Map.of("contractVersion","1.0","code",code,"message","请求未完成，请检查输入或当前状态。","retryable",status>=500));
    }
}
