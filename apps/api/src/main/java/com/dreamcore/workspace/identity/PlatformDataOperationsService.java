package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Platform operational projection. Project only whitelisted operational metadata; never return names, routes, warnings or business payloads. */
@Service
public class PlatformDataOperationsService {
 public record Counts(long total,long ready,long processing,long attention,long notStarted,long stopped) {}
 public record TenantRow(UUID tenantId,String tenantName,String tenantStatus,Counts counts,Instant lastSuccessAt) {}
 public record Overview(String kind,String query,String state,int offset,Instant checkedAt,long matchedTenants,Counts counts,List<TenantRow> items,boolean hasMore) {}
 public record Item(String monitorKey,UUID runId,String stage,String configuration,String category,String diagnostic,Instant createdAt,Instant finishedAt,Instant lastSuccessAt,String format,Long sizeBytes,Integer version,Long datasetCount,Long rowCount) {}
 public record Detail(String kind,String state,int offset,Instant checkedAt,UUID tenantId,String tenantName,String tenantStatus,Counts counts,List<Item> items,boolean hasMore) {}
 public record ArchiveRow(UUID tenantId,String tenantName,String tenantStatus,Item archive) {}
 public record Archives(String kind,String state,int offset,Instant checkedAt,Counts counts,List<ArchiveRow> items,boolean hasMore) {}
 private final JdbcTemplate db;private final IdentityService identities;private final JsonMapper json=new JsonMapper();
 public PlatformDataOperationsService(JdbcTemplate db,IdentityService identities){this.db=db;this.identities=identities;}
 private static final String COUNTS="""
  jsonb_build_object('total',count(*),'ready',count(*) FILTER(WHERE category='READY'),'processing',count(*) FILTER(WHERE category='PROCESSING'),
   'attention',count(*) FILTER(WHERE category='ATTENTION'),'notStarted',count(*) FILTER(WHERE category='NOT_STARTED'),'stopped',count(*) FILTER(WHERE category='STOPPED'))
  """;
 private String source(String kind){
  String base=kind.equals("CONNECTIONS")?"""
   SELECT c.tenant_id,md5('connection:'||c.id::text) monitor_key,r.id run_id,coalesce(r.status,'NOT_STARTED') stage,c.status configuration,NULL::text format,NULL::bigint size_bytes,NULL::integer version,
    (SELECT count(*) FROM business_datasets d WHERE d.connection_id=c.id AND d.status='ACTIVE') dataset_count,
    (SELECT coalesce(sum(s.row_count),0) FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE d.connection_id=c.id AND d.status='ACTIVE') row_count,
    CASE WHEN c.status='UNAVAILABLE' THEN 'CONNECTION_UNAVAILABLE' WHEN c.status='UNCONFIGURED' THEN 'CONNECTION_UNCONFIGURED'
     WHEN r.status IN('FAILED','INTERRUPTED') THEN CASE WHEN r.reason IN('COLLECTION_TIMEOUT','COLLECTION_INVALID_RESULT','COLLECTION_ADAPTER_FAILED','COLLECTION_INTERRUPTED') THEN r.reason ELSE 'OTHER' END ELSE NULL END diagnostic,
    coalesce(r.created_at,c.created_at) created_at,r.finished_at,
    (SELECT max(done.finished_at) FROM collection_runs done WHERE done.connection_id=c.id AND done.status='SUCCEEDED' AND done.finished_at<=statement_timestamp()) last_success_at
   FROM data_connections c LEFT JOIN LATERAL (SELECT id,status,reason,created_at,finished_at FROM collection_runs x WHERE x.connection_id=c.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) r ON true
   """:"""
   SELECT m.tenant_id,md5('material:'||m.id::text) monitor_key,r.id run_id,coalesce(r.status,'NOT_STARTED') stage,NULL::text configuration,
    CASE WHEN upper(substring(v.filename from '[.]([^.]+)$')) IN ('PDF','DOCX','XLSX','CSV','TXT','MD','JSON','PPTX','HTML') THEN upper(substring(v.filename from '[.]([^.]+)$')) ELSE 'OTHER' END format,
    v.size_bytes,v.number version,NULL::bigint dataset_count,NULL::bigint row_count,
    CASE r.status WHEN 'FAILED' THEN 'PARSE_FAILED' WHEN 'UNSUPPORTED' THEN 'UNSUPPORTED_FORMAT' WHEN 'PARTIAL' THEN 'PARTIAL_PARSE' ELSE NULL END diagnostic,
    coalesce(r.created_at,v.created_at) created_at,r.finished_at,
    (SELECT max(done.finished_at) FROM knowledge_runs done WHERE done.version_id=v.id AND done.status='READY' AND done.finished_at<=statement_timestamp()) last_success_at
   FROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
   LEFT JOIN LATERAL (SELECT id,status,created_at,finished_at FROM knowledge_runs x WHERE x.version_id=v.id ORDER BY x.generation DESC LIMIT 1) r ON true
   WHERE m.in_library
   """;
  return "WITH raw AS ("+base+"""
   ), units AS MATERIALIZED (SELECT *,CASE
    WHEN configuration='UNAVAILABLE' OR stage IN('FAILED','INTERRUPTED','PARTIAL','UNSUPPORTED') THEN 'ATTENTION'
    WHEN stage IN('QUEUED','RUNNING') THEN 'PROCESSING'
    WHEN configuration='UNCONFIGURED' THEN 'NOT_STARTED'
    WHEN stage IN('SUCCEEDED','READY') THEN 'READY' WHEN stage='CANCELLED' THEN 'STOPPED' ELSE 'NOT_STARTED' END category FROM raw)
   """;
 }
 private void validate(String kind,String state,int offset){if(!Set.of("CONNECTIONS","MATERIALS").contains(kind)||!Set.of("ALL","READY","PROCESSING","ATTENTION","NOT_STARTED","STOPPED").contains(state)||offset<0||offset>20000)throw IdentityException.invalid();}
 private void begin(UUID actor){identities.platform(actor);db.execute("SET LOCAL statement_timeout='3s'");}
 @Transactional public Overview list(UUID actor,String kind,String query,String state,int offset){
  validate(kind,state,offset);if(query==null||query.length()>180)throw IdentityException.invalid();String q=query.strip();begin(actor);
  var data=db.queryForObject(source(kind)+"""
   , grouped AS (SELECT tenant_id,%s counts,max(last_success_at) last_success_at FROM units GROUP BY tenant_id), selected AS MATERIALIZED (
    SELECT t.id,t.name,t.status,g.counts,g.last_success_at FROM tenants t LEFT JOIN grouped g ON g.tenant_id=t.id
    WHERE strpos(lower(t.name),lower(?))>0 AND (?='ALL' OR EXISTS(SELECT 1 FROM units u WHERE u.tenant_id=t.id AND u.category=?))
   ), paged AS (SELECT * FROM selected ORDER BY lower(name),id LIMIT 21 OFFSET ?)
   SELECT statement_timestamp() checked_at,(SELECT count(*) FROM selected) matched,
    (SELECT %s FROM units WHERE tenant_id IN(SELECT id FROM selected)) counts,
    coalesce((SELECT jsonb_agg(jsonb_build_object('tenantId',id,'tenantName',name,'tenantStatus',status,
     'counts',coalesce(counts,'{"total":0,"ready":0,"processing":0,"attention":0,"notStarted":0,"stopped":0}'::jsonb),'lastSuccessAt',last_success_at) ORDER BY lower(name),id) FROM paged),'[]') items
   """.formatted(COUNTS,COUNTS),(r,n)->new Overview(kind,q,state,offset,r.getTimestamp("checked_at").toInstant(),r.getLong("matched"),json.readValue(r.getString("counts"),Counts.class),Arrays.asList(json.readValue(r.getString("items"),TenantRow[].class)),false),q,state,state,offset);
  identities.platform(actor);return new Overview(kind,q,state,offset,data.checkedAt(),data.matchedTenants(),data.counts(),data.items().stream().limit(20).toList(),data.items().size()>20);
 }
 @Transactional public Archives archives(UUID actor,String kind,String state,int offset){
  validate(kind,state,offset);begin(actor);
  var data=db.queryForObject(source(kind)+"""
   , paged AS (SELECT u.*,t.name tenant_name,t.status tenant_status FROM units u JOIN tenants t ON t.id=u.tenant_id
    WHERE ?='ALL' OR category=? ORDER BY created_at DESC,monitor_key LIMIT 21 OFFSET ?)
   SELECT statement_timestamp() checked_at,(SELECT %s FROM units) counts,
    coalesce((SELECT jsonb_agg(jsonb_build_object('tenantId',tenant_id,'tenantName',tenant_name,'tenantStatus',tenant_status,
     'archive',jsonb_build_object('monitorKey',monitor_key,'runId',run_id,'stage',stage,'configuration',configuration,'category',category,'diagnostic',diagnostic,
      'createdAt',created_at,'finishedAt',finished_at,'lastSuccessAt',last_success_at,'format',format,'sizeBytes',size_bytes,'version',version,'datasetCount',dataset_count,'rowCount',row_count)) ORDER BY created_at DESC,monitor_key) FROM paged),'[]') items
   """.formatted(COUNTS),(r,n)->new Archives(kind,state,offset,r.getTimestamp("checked_at").toInstant(),json.readValue(r.getString("counts"),Counts.class),Arrays.asList(json.readValue(r.getString("items"),ArchiveRow[].class)),false),state,state,offset);
  identities.platform(actor);return new Archives(kind,state,offset,data.checkedAt(),data.counts(),data.items().stream().limit(20).toList(),data.items().size()>20);
 }
 @Transactional public Detail detail(UUID actor,UUID tenant,String kind,String state,int offset){
  validate(kind,state,offset);begin(actor);
  var t=db.queryForList("SELECT name,status FROM tenants WHERE id=? FOR SHARE",tenant);if(t.isEmpty())throw new IdentityException(404,"TENANT_NOT_FOUND");
  var data=db.queryForObject(source(kind)+"""
   , scoped AS MATERIALIZED (SELECT * FROM units WHERE tenant_id=?), paged AS (
    SELECT * FROM scoped WHERE ?='ALL' OR category=? ORDER BY created_at DESC,monitor_key LIMIT 21 OFFSET ?)
   SELECT statement_timestamp() checked_at,(SELECT %s FROM scoped) counts,
    coalesce((SELECT jsonb_agg(jsonb_build_object('monitorKey',monitor_key,'runId',run_id,'stage',stage,'configuration',configuration,'category',category,'diagnostic',diagnostic,
      'createdAt',created_at,'finishedAt',finished_at,'lastSuccessAt',last_success_at,'format',format,'sizeBytes',size_bytes,'version',version,'datasetCount',dataset_count,'rowCount',row_count) ORDER BY created_at DESC,monitor_key) FROM paged),'[]') items
   """.formatted(COUNTS),(r,n)->new Detail(kind,state,offset,r.getTimestamp("checked_at").toInstant(),tenant,(String)t.getFirst().get("name"),(String)t.getFirst().get("status"),json.readValue(r.getString("counts"),Counts.class),Arrays.asList(json.readValue(r.getString("items"),Item[].class)),false),tenant,state,state,offset);
  identities.platform(actor);return new Detail(kind,state,offset,data.checkedAt(),tenant,data.tenantName(),data.tenantStatus(),data.counts(),data.items().stream().limit(20).toList(),data.items().size()>20);
 }
}
