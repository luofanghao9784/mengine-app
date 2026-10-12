package com.dreamcore.workspace.material;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Durable request intent precedes security and body delivery. An unfinished intent is pending reconciliation. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE+20)
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class LibraryAuditFilter extends OncePerRequestFilter {
    private final JdbcTemplate db;
    private static final Pattern TENANT=Pattern.compile("^/api/(?:v1|tenant-admin/v1)/tenants/([0-9a-fA-F-]{36})(?:/|$)");
    public LibraryAuditFilter(JdbcTemplate db){this.db=db;}
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws ServletException,IOException {
        var match=TENANT.matcher(req.getRequestURI());
        if(!match.find()){chain.doFilter(req,res);return;}
        UUID tenant;try{tenant=UUID.fromString(match.group(1));}catch(IllegalArgumentException e){chain.doFilter(req,res);return;}
        UUID id=UUID.randomUUID();req.setAttribute(LibraryRequestAudit.REQUEST_ID,id);
        // Query values, headers, bodies, file names and credentials never enter the journal.
        String route=req.getRequestURI().replaceAll("[0-9a-fA-F-]{36}",":id").replaceAll("[^a-zA-Z0-9/:_-]","_");
        if(route.length()>500)route=route.substring(0,500);
        try{record(req,tenant,id,route,"RECEIVED",null);}catch(RuntimeException failure){
            res.setStatus(503);res.setContentType("application/json");res.getWriter().write("{\"code\":\"LIBRARY_AUDIT_UNAVAILABLE\"}");return;
        }
        final String path=route;
        boolean failed=false;
        try{chain.doFilter(req,res);}catch(IOException|ServletException|RuntimeException e){failed=true;throw e;}finally{
            if(req.isAsyncStarted())req.getAsyncContext().addListener(new AsyncListener(){
                public void onComplete(AsyncEvent e){finish(req,res,tenant,id,path,"RESPONSE_FINISHED");}
                public void onError(AsyncEvent e){finish(req,res,tenant,id,path,"FAILED");}
                public void onTimeout(AsyncEvent e){finish(req,res,tenant,id,path,"TIMED_OUT");}
                public void onStartAsync(AsyncEvent e){e.getAsyncContext().addListener(this);}
            });else finish(req,res,tenant,id,path,"RESPONSE_FINISHED");
        }
    }
    private void record(HttpServletRequest req,UUID tenant,UUID id,String route,String phase,Integer status){
        db.update("INSERT INTO library_request_journal(request_id,actor_id,tenant_id,method,route,phase,status) VALUES (?,?,?,?,?,?,?)",id,req.getAttribute(LibraryRequestAudit.class.getName()+".actor"),tenant,req.getMethod(),route,phase,status);
    }
    private void finish(HttpServletRequest req,HttpServletResponse res,UUID tenant,UUID id,String route,String phase){
        try{record(req,tenant,id,route,phase,res.getStatus());}catch(RuntimeException failure){
            logger.error("Audit outcome pending reconciliation for request "+id,failure);
        }
    }
}
