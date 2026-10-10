package com.dreamcore.workspace.identity;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.departure.DepartureAccess;
@Service
public class WorkspaceArchiveService {
 public record State(UUID id,boolean archived,long revision,long dependentRecords) {}
 private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;private final DepartureAccess departure;
 public WorkspaceArchiveService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,DepartureAccess departure){this.db=db;this.identities=identities;this.audit=audit;this.departure=departure;}
 private Map<String,Object> require(UUID actor,UUID tenant,UUID id){
  String role=identities.member(actor,tenant,false);
  var rows=db.queryForList("SELECT * FROM workspaces WHERE tenant_id=? AND id=? AND kind='SHARED'",tenant,id);
  if(rows.isEmpty())throw new IdentityException(404,"WORKSPACE_NOT_FOUND");var w=rows.getFirst();
  if(!role.equals("TENANT_ADMIN")&& !(Boolean.TRUE.equals(w.get("responsibility_confirmed"))&&actor.equals(w.get("owner_id"))))throw IdentityException.denied();return w;
 }
 private long dependencies(UUID id){
  long count=0;
  for(String table:db.queryForList("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='workspace_id' AND table_name IN(SELECT tablename FROM pg_tables WHERE schemaname='public') AND table_name NOT IN('workspace_members','workspace_owner_changes','identity_audit','governance_capabilities')",String.class))
   count+=db.queryForObject("SELECT count(*) FROM \""+table.replace("\"","\"\"")+"\" WHERE workspace_id=?",Long.class,id);
  return count;
 }
 @Transactional public State get(UUID actor,UUID tenant,UUID id){var w=require(actor,tenant,id);return new State(id,(Boolean)w.get("archived"),((Number)w.get("management_version")).longValue(),dependencies(id));}
 @Transactional public State act(UUID actor,UUID tenant,UUID id,UUID request,long expected,boolean archived){
  if(expected<0)throw IdentityException.invalid();require(actor,tenant,id);
  UUID prior=identities.priorRequest(actor,request,"WORKSPACE_ARCHIVE",IdentityService.hash(tenant+"\n"+id+"\n"+expected+"\n"+archived));
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);departure.requireActiveBusiness(actor,tenant);var w=require(actor,tenant,id);
  db.queryForList("SELECT id FROM workspaces WHERE id=? FOR UPDATE",id);
  if(prior!=null)return get(actor,tenant,id);
  if(((Number)w.get("management_version")).longValue()!=expected)throw new IdentityException(409,"STATE_CONFLICT");
  if(archived&&dependencies(id)>0)throw new IdentityException(409,"WORKSPACE_ARCHIVE_DEPENDENCIES");
  db.update("UPDATE workspaces SET archived=?,management_version=management_version+1 WHERE id=?",archived,id);
  identities.remember(actor,request,"WORKSPACE_ARCHIVE",IdentityService.hash(tenant+"\n"+id+"\n"+expected+"\n"+archived),id);audit.record(actor,tenant,archived?"WORKSPACE_ARCHIVE":"WORKSPACE_RESTORE",id,"SUCCESS");return get(actor,tenant,id);
 }
}
