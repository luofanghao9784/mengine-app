package com.dreamcore.workspace.departure;
import com.dreamcore.workspace.identity.IdentityException;
import java.time.Instant;import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Component;
/** No identity/material/service dependencies: safe to call from the existing authorization boundaries.
 * Callers must retain the tenant lock throughout authorization and reads/writes. */
@Component public class DepartureAccess {
 private final JdbcTemplate db;public DepartureAccess(JdbcTemplate db){this.db=db;}
 private boolean effective(UUID tenant,UUID account){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=? AND state<>'CANCELLED' AND (kind='TENANT_EXIT' OR target_account_id=?))",Boolean.class,tenant,account));}
 public boolean exiting(UUID tenant){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=? AND kind='TENANT_EXIT' AND state<>'CANCELLED')",Boolean.class,tenant));}
 public void requireActiveBusiness(UUID actor,UUID tenant){if(effective(tenant,actor))throw new IdentityException(409,"DEPARTURE_BUSINESS_STOPPED");}
 /** A shared workspace does not turn its owner-private conversations, feedback or drafts into enterprise export assets. */
 public void requirePrivateRead(UUID actor,UUID tenant){if(effective(tenant,actor))throw new IdentityException(403,"DEPARTURE_PRIVATE_ACCESS_STOPPED");}
 public void requireContentRead(UUID actor,UUID tenant,UUID workspace){
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT departure_content_readable(?,?,?)",Boolean.class,actor,tenant,workspace)))throw new IdentityException(403,"DEPARTURE_EXPORT_SCOPE_REQUIRED");
 }
 public void requireMemberActivation(UUID tenant,UUID member){if(effective(tenant,member))throw new IdentityException(409,"DEPARTURE_REACTIVATION_BLOCKED");}
 public void requireTenantActivation(UUID tenant){if(exiting(tenant))throw new IdentityException(409,"DEPARTURE_REACTIVATION_BLOCKED");}
 public boolean allowsTask(UUID task){return !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tasks t JOIN departure_executions e ON e.tenant_id=t.tenant_id AND (e.kind='TENANT_EXIT' OR e.target_account_id=t.requested_by) WHERE t.id=? AND e.state<>'CANCELLED')",Boolean.class,task));}
 /** Generation captures the earlier date once; downloads must still re-check current scope permission. */
 public Instant capPackageExpiry(UUID actor,UUID tenant,UUID workspace,Instant requested){requireContentRead(actor,tenant,workspace);var values=db.query("SELECT deadline FROM departure_executions WHERE tenant_id=? AND kind='TENANT_EXIT' AND state<>'CANCELLED'",(r,n)->r.getTimestamp(1).toInstant(),tenant);return values.isEmpty()||requested.isBefore(values.getFirst())?requested:values.getFirst();}
}
