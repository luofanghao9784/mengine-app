package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Public projections never include a contributing tenant, source, run, or evidence identity. */
@Service
public class GeneralExperienceLibrary {
 public record Summary(UUID id,UUID versionId,int number,String status,String title,String summary,List<String> tags,Instant updatedAt) {}
 public record Page(List<Summary> items,boolean hasMore) {}
 public record Detail(UUID id,UUID versionId,int number,String status,ExperienceGeneralizationRuntime.Method method,Instant updatedAt) {}
 public record Processing(boolean enabled,Map<String,Long> counts,long available,long stopped,long withdrawn,Instant checkedAt) {}
 private final JdbcTemplate db;private final IdentityService identities;private final ExperienceManagementService management;
 private final JsonMapper json=new JsonMapper();
 public GeneralExperienceLibrary(JdbcTemplate db,IdentityService identities,ExperienceManagementService management){this.db=db;this.identities=identities;this.management=management;}
 private static final String BASE="""
  SELECT e.id,e.status,e.updated_at,v.id version_id,v.number,v.method
  FROM general_experience_entries e JOIN general_experience_versions v ON v.id=e.published_version AND v.entry_id=e.id
  WHERE v.method IS NOT NULL AND (general_experience_available(v.id) OR
   (? AND e.status='STOPPED' AND general_experience_history_readable(v.id)))
  """;
 private void access(UUID actor,UUID tenant){if(tenant==null)identities.platform(actor);else management.requireLibraryAccess(actor,tenant);}
 private ExperienceGeneralizationRuntime.Method method(Map<String,Object> row){return json.readValue(row.get("method").toString(),ExperienceGeneralizationRuntime.Method.class);}
 private Instant updated(Map<String,Object> row){return ((java.sql.Timestamp)row.get("updated_at")).toInstant();}
 @Transactional public Page contents(UUID actor,UUID tenant,String query,String state,int offset){
  access(actor,tenant);
  if(query==null||query.length()>200||offset<0||offset>100000||!Set.of("AVAILABLE","STOPPED").contains(state))throw IdentityException.invalid();
  String filter=tenant==null?" AND e.status=?":" AND e.status='AVAILABLE' AND tenant_general_experience_enabled(?::uuid,e.id)=?";
  var args=new ArrayList<Object>();args.add(tenant==null);if(tenant==null)args.add(state);else {args.add(tenant);args.add(state.equals("AVAILABLE"));}args.add(query.strip());args.add(offset);
  var rows=db.queryForList(BASE+filter+" AND strpos(lower(concat_ws(' ',v.method->>'title',v.method->>'summary',v.method->'tags')),lower(?))>0 ORDER BY e.updated_at DESC,e.id LIMIT 21 OFFSET ?",args.toArray());
  var items=rows.stream().limit(20).map(r->{var m=method(r);return new Summary((UUID)r.get("id"),(UUID)r.get("version_id"),((Number)r.get("number")).intValue(),(String)r.get("status"),m.title(),m.summary(),m.tags(),updated(r));}).toList();
  return new Page(items,rows.size()>20);
 }
 @Transactional public Detail detail(UUID actor,UUID tenant,UUID entry,UUID version){
  access(actor,tenant);
  var rows=db.queryForList(BASE+" AND e.id=? AND v.id=?",tenant==null,entry,version);
  if(rows.isEmpty())throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");
  var r=rows.getFirst();return new Detail(entry,version,((Number)r.get("number")).intValue(),(String)r.get("status"),method(r),updated(r));
 }
 static final Set<String> STATES=Set.of("WAITING","PROCESSING","RETRYING","ADMITTED","DUPLICATE","NOT_ADMITTED","UNAVAILABLE","FAILED","UNKNOWN");
 @Transactional public Processing processing(UUID actor,boolean enabled){
  identities.platform(actor);var counts=new TreeMap<String,Long>();STATES.forEach(s->counts.put(s,0L));
  for(var r:db.queryForList("""
   SELECT state,count(*) total FROM (SELECT CASE
    WHEN state='QUEUED' THEN 'WAITING' WHEN state IN ('RUNNING','QUALIFIED') THEN 'PROCESSING'
    WHEN state='RETRY_WAIT' THEN 'RETRYING' WHEN state IN ('SKIPPED','REJECTED','CONFLICT') THEN 'NOT_ADMITTED'
    WHEN state='SOURCE_UNAVAILABLE' THEN 'UNAVAILABLE' ELSE state END state FROM experience_generalization_sources
    UNION ALL SELECT CASE WHEN state='QUEUED' THEN 'WAITING' WHEN state IN ('RUNNING','UNCERTAIN','PUBLISHING') THEN 'PROCESSING'
     WHEN state='RETRY_WAIT' THEN 'RETRYING' WHEN state IN ('SKIPPED','REJECTED','CONFLICT') THEN 'NOT_ADMITTED'
     ELSE state END state FROM general_experience_adjustments) s GROUP BY state
   """))counts.put((String)r.get("state"),((Number)r.get("total")).longValue());
  var rows=db.queryForList("SELECT status,count(*) total FROM ("+BASE+") readable GROUP BY status",true);
  long available=0,stopped=0;for(var r:rows){if(r.get("status").equals("AVAILABLE"))available=((Number)r.get("total")).longValue();else stopped=((Number)r.get("total")).longValue();}
  long withdrawn=db.queryForObject("SELECT count(*) FROM general_experience_entries WHERE status='WITHDRAWN'",Long.class);
  return new Processing(enabled,counts,available,stopped,withdrawn,Instant.now());
 }
}
