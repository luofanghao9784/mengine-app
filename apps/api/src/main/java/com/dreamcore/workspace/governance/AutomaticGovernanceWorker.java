package com.dreamcore.workspace.governance;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class AutomaticGovernanceWorker {
 private static final int PAGE_SIZE=1000;
 private static final Cursor BEGIN=new Cursor("",new UUID(0,0));
 private record Cursor(String kind,UUID id) {}
 private final JdbcTemplate db;
 private final AutomaticGovernanceService service;
 private final List<UUID> tenants;
 private final boolean enabled;
 // Position follows inspected sources, including waiting/failed jobs. It never changes paid-call retry policy.
 private final Map<UUID,Cursor> sourcePositions=new HashMap<>();
 private int nextTenant;

 public AutomaticGovernanceWorker(JdbcTemplate db,AutomaticGovernanceService service,
     @Value("${dreamcore.knowledge.automatic-tenants:}") String configured,
     @Value("${dreamcore.governance.dispatch-enabled:false}") boolean enabled) {
  this.db=db;this.service=service;this.enabled=enabled;
  var configuredTenants=new LinkedHashSet<UUID>();
  for(String value:configured.split(","))if(!value.isBlank())configuredTenants.add(UUID.fromString(value.trim()));
  this.tenants=List.copyOf(configuredTenants);
 }

 @Scheduled(fixedDelayString="${dreamcore.knowledge.poll-ms:30000}",initialDelayString="${dreamcore.knowledge.initial-delay-ms:15000}")
 public synchronized void tick() {
  if(!enabled||tenants.isEmpty())return;
  int queued=0;
  int start=nextTenant;
  // Rotate even when the first enterprise consumes the entire four-job budget.
  nextTenant=(nextTenant+1)%tenants.size();
  for(int offset=0;offset<tenants.size();offset++) {
   UUID tenant=tenants.get((start+offset)%tenants.size());
   var owners=db.queryForList("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant);
   if(owners.isEmpty())continue;
   Cursor after=sourcePositions.getOrDefault(tenant,BEGIN);
   var sources=db.queryForList("""
       SELECT id,kind FROM (
        SELECT id,'DATASET' kind FROM business_datasets
         WHERE tenant_id=? AND status='ACTIVE' AND NOT scrubbed AND current_snapshot IS NOT NULL
        UNION ALL
        SELECT m.id,'MATERIAL' kind FROM active_materials m
         JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id
         WHERE m.tenant_id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived
       ) sources WHERE (kind,id)>(?::text,?::uuid) ORDER BY kind,id LIMIT 1000
       """,tenant,tenant,after.kind(),after.id());
   for(var source:sources) {
    UUID id=(UUID)source.get("id");String kind=source.get("kind").toString();
    sourcePositions.put(tenant,new Cursor(kind,id));
    try {
     if(service.reconcile(owners.getFirst(),tenant,kind,id)&&++queued>=4)return;
    } catch(RuntimeException waiting) {
     // Fail closed; no paid retry and no source content in logs.
    }
   }
   // Wrap only after consuming the page; an early budget return retains its precise last inspected source.
   if(sources.size()<PAGE_SIZE)sourcePositions.remove(tenant);
  }
 }
}
