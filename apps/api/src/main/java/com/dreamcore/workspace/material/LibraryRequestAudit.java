package com.dreamcore.workspace.material;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Request attempts complement committed domain events; neither is a claim of the other. */
@Configuration
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class LibraryRequestAudit implements WebMvcConfigurer, HandlerInterceptor {
    public static final String REQUEST_ID=LibraryRequestAudit.class.getName()+".requestId";
    private static final String ACTOR=LibraryRequestAudit.class.getName()+".actor";
    private final JdbcTemplate db;
    private final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(getClass());
    public LibraryRequestAudit(JdbcTemplate db){this.db=db;}
    @Override public void addInterceptors(InterceptorRegistry registry){registry.addInterceptor(this).addPathPatterns("/api/v1/tenants/**","/api/tenant-admin/v1/tenants/**");}
    @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler){
        if(request.getAttribute(REQUEST_ID)==null)request.setAttribute(REQUEST_ID,UUID.randomUUID());
        var auth=SecurityContextHolder.getContext().getAuthentication();
        if(auth!=null)try{request.setAttribute(ACTOR,UUID.fromString(auth.getName()));}catch(IllegalArgumentException ignored){}
        return true;
    }
    @Override public void afterCompletion(HttpServletRequest request,HttpServletResponse response,Object handler,Exception error){
        if(!(handler instanceof HandlerMethod method))return;
        String type=method.getBeanType().getSimpleName();
        if(!Set.of("MaterialController","MaterialLifecycleController","LibraryPermissionController","LibraryMoveController","KnowledgeController","MaterialGovernanceController").contains(type))return;
        Object raw=request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        if(!(raw instanceof Map<?,?> vars))return;
        UUID tenant=id(vars.get("tenant"));if(tenant==null)return;
        try{
            if(!Boolean.TRUE.equals(db.queryForObject("SELECT library_permissions_enabled(?)",Boolean.class,tenant)))return;
            UUID object=id(vars.get("material")),space=id(vars.get("workspace"));if(space==null)space=id(vars.get("space"));String kind="MATERIAL";
            if(object==null&&vars.get("kind") instanceof String k&&Set.of("MATERIAL","FOLDER","WORKSPACE").contains(k)){kind=k;object=id(vars.get("id"));}
            if(object==null&&type.equals("LibraryMoveController")){kind=Objects.toString(vars.get("kind"),"");object=id(vars.get("id"));}
            if(object==null&&type.equals("LibraryPermissionController")&&method.getMethod().getName().equals("department")){kind="DEPARTMENT";object=id(vars.get("id"));}
            if(object==null){kind="WORKSPACE";object=space;}
            if(object==null)return; // Tenant-wide lists are not falsely attached to an arbitrary file.
            int status=response.getStatus();String outcome=error!=null||status>=500?"FAILED":status==409?"CONFLICT":status>=400?"DENIED":"SUCCESS";
            String action=switch(method.getMethod().getName()){
                case "download"->"REQUEST_DOWNLOAD";case "detail","exactVersion","version","analysis","citation"->"REQUEST_READ";
                case "save","policy"->"REQUEST_PERMISSIONS";case "preview"->"REQUEST_PREVIEW";
                case "move","commit"->"REQUEST_MOVE";case "events"->"REQUEST_AUDIT_READ";
                default->"REQUEST_"+method.getMethod().getName().toUpperCase(Locale.ROOT);
            };
            db.update("INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,request_id,version_id,execution_source,http_status) VALUES (?,?,?,?,?,?,?,?,?,'HUMAN',?)",
                tenant,space,kind,object,request.getAttribute(ACTOR),action,outcome,request.getAttribute(REQUEST_ID),id(vars.get("version")),status);
        }catch(RuntimeException auditFailure){
            // The response may already have committed. Never turn a committed mutation into a fake rollback.
            log.error("Library request audit failed; request {} needs reconciliation",request.getAttribute(REQUEST_ID),auditFailure);
        }
    }
    private static UUID id(Object value){if(value==null)return null;try{return UUID.fromString(value.toString());}catch(IllegalArgumentException ignored){return null;}}
}
