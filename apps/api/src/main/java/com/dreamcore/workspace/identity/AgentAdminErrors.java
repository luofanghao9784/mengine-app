package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Error wording is scoped to this realm; other identity APIs retain their existing contract. */
@Order(-1)
@RestControllerAdvice(assignableTypes=AgentAdminIdentityController.class)
public class AgentAdminErrors {
    static String message(String code) {
        return switch(code) {
            case "AUTHENTICATION_REQUIRED" -> "还没有登录，请先登录后再试";
            case "INVALID_CREDENTIALS" -> "账号或密码不对，请重新输入";
            case "LOGIN_THROTTLED" -> "尝试次数太多，请稍后再试";
            case "ACCESS_DENIED" -> "登录校验未通过，请刷新页面后再试";
            default -> "输入的信息不完整或格式不对，请检查后再试";
        };
    }
    static Map<String,Object> body(int status,String code) {
        return Map.of("contractVersion","1.0","code",code,"message",message(code),"retryable",status>=500);
    }
    @ExceptionHandler(IdentityException.class)
    ResponseEntity<?> identity(IdentityException error) {
        return ResponseEntity.status(error.status).header("Cache-Control","no-store").body(body(error.status,error.code));
    }
    @ExceptionHandler({org.springframework.web.bind.MethodArgumentNotValidException.class,org.springframework.http.converter.HttpMessageNotReadableException.class})
    ResponseEntity<?> invalid() { return ResponseEntity.badRequest().header("Cache-Control","no-store").body(body(400,"INVALID_REQUEST")); }
    static void writeError(HttpServletResponse response,int status,String code) throws IOException {
        response.setStatus(status); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");
        response.getWriter().write("{\"contractVersion\":\"1.0\",\"code\":\""+code+"\",\"message\":\""+message(code)+"\",\"retryable\":false}");
    }
}
