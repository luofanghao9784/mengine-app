package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.identity.IdentityException;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

@Service
public class OnboardingReconciliationService {
 private final JdbcTemplate db;private final CollectionService collection;private final String registry;
 private static final JsonMapper JSON=new JsonMapper();
 public OnboardingReconciliationService(JdbcTemplate db,CollectionService collection,@Value("${dreamcore.onboarding.recipe-file:}") String registry){this.db=db;this.collection=collection;this.registry=registry;}
 public Object catalog(UUID actor,UUID tenant){
  if(registry.isBlank())return Map.of("stores",List.of());
  try{var c=JSON.readTree(Files.readString(Path.of(registry)));if(!tenant.toString().equals(c.path("tenantId").asText()))return Map.of("stores",List.of());
   var stores=new ArrayList<Object>();for(var entry:c.path("stores").properties()){
    boolean readable=true;
    for(String table:List.of("full_orders","payment_orders","t_course_refund_records"))
     readable &= collection.readable(actor,tenant,UUID.fromString(entry.getValue().path(table).path("datasetId").asText()));
    if(readable)stores.add(Map.of("id",entry.getKey(),"name",c.path("storeNames").path(entry.getKey()).asText(entry.getKey())));
   }return Map.of("stores",stores);
  }catch(Exception e){throw new IdentityException(409,"ONBOARDING_RECIPE_UNAVAILABLE");}
 }
 public record Inputs(Map<String,String> snapshots,List<UUID> backgrounds) {}
 public Inputs inputs(UUID tenant,String store){
  try{var c=JSON.readTree(Files.readString(Path.of(registry)));
   if(!tenant.toString().equals(c.path("tenantId").asText())||!c.path("stores").has(store))throw IdentityException.invalid();
   var pins=new LinkedHashMap<String,String>();for(var e:c.path("stores").path(store).properties())pins.put(e.getValue().path("datasetId").asText(),e.getValue().path("snapshotId").asText());
   var refs=new ArrayList<UUID>();for(var v:c.path("backgroundVersionIds"))refs.add(UUID.fromString(v.asText()));
   return new Inputs(pins,refs);
  }catch(IdentityException e){throw e;}catch(Exception e){throw new IdentityException(409,"ONBOARDING_RECIPE_UNAVAILABLE");}
 }
 public record Request(String storeId,String dateFrom,String dateTo) {}
 // Existing identity checks acquire FOR SHARE locks; transaction must permit locks. No business writes.
 @Transactional(isolation=Isolation.REPEATABLE_READ)
 public Object execute(UUID actor,UUID tenant,Request request){
  if(registry.isBlank())throw new IdentityException(409,"ONBOARDING_RECIPE_NOT_INSTALLED");
  try{
   var config=JSON.readTree(Files.readString(Path.of(registry)));
   if(!tenant.toString().equals(config.path("tenantId").asText())||!OnboardingReconciliation.VERSION.equals(config.path("ruleVersion").asText()))throw new IdentityException(404,"ONBOARDING_RECIPE_UNAVAILABLE");
   if(request==null||request.storeId()==null||!config.path("stores").has(request.storeId()))throw IdentityException.invalid();
   LocalDate from=LocalDate.parse(request.dateFrom()),to=LocalDate.parse(request.dateTo());if(from.isAfter(to))throw IdentityException.invalid();
   var sources=config.path("stores").path(request.storeId());var pins=new TreeMap<String,String>();var tables=new LinkedHashMap<String,List<Map<String,String>>>();
   // Authorize every input before loading any rows; registry is deployment-owned, never caller supplied.
   for(String table:List.of("full_orders","payment_orders","t_course_refund_records")){
    var source=sources.path(table);UUID id=UUID.fromString(source.path("datasetId").asText());
    collection.preview(actor,tenant,id,0,1);
    var snapshot=db.queryForMap("SELECT current_snapshot,column_names FROM business_datasets WHERE id=? AND tenant_id=?",id,tenant);
    if(!source.path("snapshotId").asText().equals(String.valueOf(snapshot.get("current_snapshot"))))throw new IdentityException(409,"ONBOARDING_INPUT_CHANGED");
    pins.put(table,id+":"+source.path("snapshotId").asText());
   }
   for(var ref:config.path("backgroundVersionIds"))if(!Boolean.TRUE.equals(db.queryForObject("SELECT background_version_current(?,?)",Boolean.class,tenant,UUID.fromString(ref.asText()))))throw new IdentityException(409,"BACKGROUND_REFERENCE_CHANGED");
   for(String table:pins.keySet()){
    var source=sources.path(table);UUID id=UUID.fromString(source.path("datasetId").asText());
    var data=db.queryForMap("SELECT d.column_names,s.data_rows FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=d.current_snapshot WHERE d.id=? AND d.tenant_id=?",id,tenant);
    var columns=JSON.readTree(data.get("column_names").toString());var rows=new ArrayList<Map<String,String>>();
    for(var row:JSON.readTree(data.get("data_rows").toString())){var item=new LinkedHashMap<String,String>();for(int i=0;i<columns.size();i++)item.put(columns.get(i).asText(),row.get(i).isNull()?null:row.get(i).asText());rows.add(item);}
    tables.put(table,rows);
   }
   var result=OnboardingReconciliation.evaluate(tables,request.storeId(),from,to);
   // Pure read-only operation: repeated identical inputs have an identical receipt identity.
   String fingerprint=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((actor+":"+tenant+":confirmed-order-sales-v1:"+JSON.writeValueAsString(config)+":"+request+":"+pins).getBytes(StandardCharsets.UTF_8)));
   return Map.of("receiptId",fingerprint,"ruleVersion",OnboardingReconciliation.VERSION,"inputs",pins,"period",request,"timeZone","Asia/Shanghai","result",result,"limitations",List.of("Current-state fixed snapshot, not historical state reconstruction","Subset totals; inspect unknown counts","Finance-confirmed is a subset, do not add to business-confirmed","No net income or profit; no original downloads"));
  }catch(IdentityException e){throw e;}catch(Exception e){org.slf4j.LoggerFactory.getLogger(getClass()).warn("Fixed recipe rejected: {} at {}",e.getClass().getSimpleName(),e.getStackTrace().length==0?"unknown":e.getStackTrace()[0]);throw new IdentityException(422,"ONBOARDING_RECIPE_OR_INPUT_INVALID");}
 }
}
