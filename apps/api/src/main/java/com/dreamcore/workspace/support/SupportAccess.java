package com.dreamcore.workspace.support;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service public class SupportAccess {
 private final JdbcTemplate db;
 public SupportAccess(JdbcTemplate db){this.db=db;}
 private static final String SELECT="""
 SELECT s.id,s.actor_id,s.tenant_id,g.owner_id,s.mode,t.name FROM headquarters_support_access s
 JOIN platform_sessions p ON p.token_hash=s.session_hash AND p.account_id=s.actor_id
 JOIN accounts a ON a.id=s.actor_id AND a.status='ACTIVE' AND a.credential_version=p.credential_version
 JOIN tenants t ON t.id=s.tenant_id JOIN tenant_governance g ON g.tenant_id=t.id
 JOIN tenant_memberships m ON m.tenant_id=t.id AND m.account_id=g.owner_id AND m.status='ACTIVE'
 JOIN accounts o ON o.id=g.owner_id AND o.status='ACTIVE'
 WHERE s.closed_at IS NULL AND p.expires_at>now() AND EXISTS
 (SELECT 1 FROM platform_roles r WHERE r.account_id=s.actor_id AND r.role='PLATFORM_ADMIN')
 """;
 public SupportContext.Access read(UUID id,String sessionHash){
  var rows=db.query(SELECT+" AND s.id=? AND s.session_hash=?",(r,n)->new SupportContext.Access(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),r.getObject(4,UUID.class),r.getString(5),r.getString(6)),id,sessionHash);
  if(rows.isEmpty())throw new IdentityException(403,"SUPPORT_ACCESS_EXPIRED");return rows.getFirst();
 }
 @Transactional public SupportContext.Access enter(PlatformIdentity.Session session,UUID tenant,String mode){
  if(session==null||session.actor()==null)throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
  if(tenant==null||mode==null||!Set.of("ADJUSTMENT","TEST").contains(mode))throw IdentityException.invalid();
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);
  UUID id=UUID.randomUUID();db.update("INSERT INTO headquarters_support_access(id,actor_id,tenant_id,session_hash,mode) VALUES (?,?,?,?,?)",id,session.actor(),tenant,session.tokenHash(),mode);
  var result=read(id,session.tokenHash());event(result,"ENTER","SUCCESS",null);return result;
 }
 public void leave(UUID id,PlatformIdentity.Session session){var a=read(id,session.tokenHash());db.update("UPDATE headquarters_support_access SET closed_at=now() WHERE id=?",id);event(a,"LEAVE","SUCCESS",null);}
 public void expireDue(){
  var rows=db.query("UPDATE headquarters_support_access s SET closed_at=now() WHERE closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM platform_sessions p WHERE p.token_hash=s.session_hash AND p.expires_at>now()) RETURNING id,actor_id,tenant_id,mode",(r,n)->new SupportContext.Access(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),null,r.getString(4),""));
  rows.forEach(a->event(a,"INVALIDATED","DENIED",403));
 }
 public void invalidated(UUID id,String hash){
  if(hash==null)return;
  var rows=db.query("UPDATE headquarters_support_access SET closed_at=now() WHERE id=? AND session_hash=? AND closed_at IS NULL RETURNING id,actor_id,tenant_id,mode",(r,n)->new SupportContext.Access(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),null,r.getString(4),""),id,hash);
  rows.forEach(a->event(a,"INVALIDATED","DENIED",403));
 }
 public void enterDenied(UUID actor,UUID tenant,String mode,int status){
  db.update("INSERT INTO headquarters_support_events(actor_id,tenant_id,mode,action,outcome,http_status) SELECT ?,id,?,'ENTER','DENIED',? FROM tenants WHERE id=?",actor,mode!=null&&Set.of("ADJUSTMENT","TEST").contains(mode)?mode:"UNKNOWN",status,tenant);
 }
 public List<Map<String,Object>> visits(UUID tenant,int offset){
  if(offset<0||offset>100000)throw IdentityException.invalid();
  return db.queryForList("SELECT s.id,s.actor_id,a.display_name AS actor_name,s.mode,s.created_at,s.closed_at FROM headquarters_support_access s JOIN accounts a ON a.id=s.actor_id WHERE s.tenant_id=? ORDER BY s.created_at DESC LIMIT 50 OFFSET ?",tenant,offset);
 }
 public java.util.Map<String,Object> records(UUID id,String hash,int offset){
  if(offset<0||offset>100000)throw IdentityException.invalid();
  return Map.of("events",db.queryForList("SELECT id,action,outcome,http_status,created_at FROM headquarters_support_events WHERE access_id=? ORDER BY id DESC LIMIT 50 OFFSET ?",id,offset),"changes",db.queryForList("SELECT table_name,object_id,operation,before_state,after_state,created_at FROM headquarters_support_changes WHERE access_id=? ORDER BY id DESC LIMIT 50 OFFSET ?",id,offset));
 }
 public void event(SupportContext.Access a,String action,String outcome,Integer status){
  db.update("INSERT INTO headquarters_support_events(access_id,actor_id,tenant_id,mode,action,outcome,http_status) VALUES (?,?,?,?,?,?,?)",a.id(),a.actor(),a.tenant(),a.mode(),action,outcome,status);
 }
 public UUID permissionActor(UUID actor,UUID tenant){
  var a=SupportContext.current();if(a==null)return actor;
  if(!a.actor().equals(actor)||!a.tenant().equals(tenant))throw new IdentityException(403,"SUPPORT_SCOPE_DENIED");
  // Re-read current owner, credentials, role and session after every tenant lock/wait.
  String hash=db.queryForObject("SELECT session_hash FROM headquarters_support_access WHERE id=?",String.class,a.id());
  return read(a.id(),hash).owner();
 }
 public boolean active(UUID actor,UUID tenant){return !permissionActor(actor,tenant).equals(actor);}
 /** Background work can resume only the exact context captured at creation, never any later visit. */
 public void bindObject(UUID actor,UUID tenant,String table,UUID object){
  var bound=forObject(actor,tenant,table,object);if(bound==null)return;
  var previous=SupportContext.current();if(previous!=null){if(!previous.id().equals(bound.id()))throw new IdentityException(403,"SUPPORT_SCOPE_DENIED");return;}
  if(!org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive())throw new IllegalStateException("Support background binding needs a transaction");
  SupportContext.set(bound);
  org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(new org.springframework.transaction.support.TransactionSynchronization(){
   public void afterCompletion(int status){SupportContext.set(previous);}
  });
  db.queryForObject("SELECT set_config('dreamcore.support_access',?,true)",String.class,bound.id().toString());
 }
 public SupportContext.Access forObject(UUID actor,UUID tenant,String table,UUID object){
  var rows=db.queryForList("SELECT DISTINCT c.access_id,s.session_hash FROM headquarters_support_changes c JOIN headquarters_support_access s ON s.id=c.access_id WHERE c.operation='INSERT' AND c.table_name=? AND c.object_id=? AND s.actor_id=? AND s.tenant_id=? ORDER BY c.access_id",table,object.toString(),actor,tenant);
  if(rows.isEmpty()){
   // A platform administrator may also perform ordinary work as a tenant member.
   // Support-created objects remain distinguished by their immutable access provenance.
   return null;
  }
  var r=rows.getFirst();return read((UUID)r.get("access_id"),(String)r.get("session_hash"));
 }
}
