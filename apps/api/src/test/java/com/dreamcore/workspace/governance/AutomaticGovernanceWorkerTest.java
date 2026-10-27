package com.dreamcore.workspace.governance;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AutomaticGovernanceWorkerTest {
 private static final UUID OWNER=new UUID(0,9000);
 private static List<Map<String,Object>> sources(int count) {
  var sources=new ArrayList<Map<String,Object>>();
  for(int i=1;i<=count;i++)sources.add(Map.of("id",new UUID(0,i),"kind",i<=1000?"DATASET":"MATERIAL"));
  return sources;
 }
 private JdbcTemplate database(Map<UUID,List<Map<String,Object>>> inventory) {
  var db=mock(JdbcTemplate.class);
  when(db.queryForList(startsWith("SELECT owner_id"),eq(UUID.class),any(UUID.class))).thenReturn(List.of(OWNER));
  // Simulate keyset SQL. Existing unpaged worker always sees the first 1000, as PostgreSQL does.
  doAnswer(call->{
   Object[] args=call.getArguments();UUID tenant=(UUID)args[1];String afterKind=args.length>3?(String)args[3]:"";UUID after=args.length>4?(UUID)args[4]:new UUID(0,0);
   return inventory.getOrDefault(tenant,List.of()).stream().filter(row->{
    int kind=row.get("kind").toString().compareTo(afterKind);
    return kind>0 || kind==0 && row.get("id").toString().compareTo(after.toString())>0;
   }).limit(1000).toList();
  }).when(db).queryForList(contains("FROM business_datasets"),any(Object[].class));
  return db;
 }
 @Test void pagesPastFirstThousandAndWrapsBackToEarlierSources() {
  UUID tenant=new UUID(0,42);var inventory=sources(1002);var db=database(Map.of(tenant,inventory));var service=mock(AutomaticGovernanceService.class);
  var visited=new LinkedHashSet<UUID>();when(service.reconcile(eq(OWNER),eq(tenant),anyString(),any(UUID.class))).thenAnswer(call->{visited.add(call.getArgument(3));return false;});
  var worker=new AutomaticGovernanceWorker(db,service,tenant.toString(),true);
  worker.tick();assertEquals(1000,visited.size());worker.tick();
  assertEquals(1002,visited.size(),"Sources beyond the first 1000 must be inspected on the next bounded page");
  clearInvocations(service);worker.tick();verify(service).reconcile(OWNER,tenant,"DATASET",new UUID(0,1));
 }
 @Test void fourTaskBudgetAdvancesSourceAndRotatesTenantInsteadOfStarvingLaterTenants() {
  UUID first=new UUID(0,42),second=new UUID(0,43);var db=database(Map.of(first,sources(12),second,sources(12)));var service=mock(AutomaticGovernanceService.class);
  when(service.reconcile(any(),any(),anyString(),any())).thenReturn(true);
  var worker=new AutomaticGovernanceWorker(db,service,first+","+second,true);
  worker.tick();verify(service,times(4)).reconcile(eq(OWNER),eq(first),anyString(),any());verify(service,never()).reconcile(eq(OWNER),eq(second),anyString(),any());
  clearInvocations(service);worker.tick();verify(service,times(4)).reconcile(eq(OWNER),eq(second),anyString(),any());
  clearInvocations(service);worker.tick();verify(service,times(4)).reconcile(eq(OWNER),eq(first),anyString(),any());verify(service).reconcile(OWNER,first,"DATASET",new UUID(0,5));verify(service,never()).reconcile(OWNER,first,"DATASET",new UUID(0,1));
 }
 @Test void disabledOrUnlistedTenantsNeverRunAndFailuresDoNotStopCursorProgress() {
  UUID tenant=new UUID(0,42);var db=database(Map.of(tenant,sources(1002)));var service=mock(AutomaticGovernanceService.class);
  new AutomaticGovernanceWorker(db,service,tenant.toString(),false).tick();new AutomaticGovernanceWorker(db,service,"",true).tick();verifyNoInteractions(service);
  when(service.reconcile(eq(OWNER),eq(tenant),anyString(),any())).thenThrow(new IllegalStateException("waiting"));
  var worker=new AutomaticGovernanceWorker(db,service,tenant.toString(),true);worker.tick();worker.tick();
  verify(service).reconcile(OWNER,tenant,"MATERIAL",new UUID(0,1002));
 }
}
