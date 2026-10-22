package com.dreamcore.workspace.profile;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Deterministic reference knowledge, not model-authored articles or authorization. */
@Service
public class BackgroundKnowledgeService {
 public record Method(UUID id,int version,String name,String status) {}
 public record Knowledge(String id,UUID sourceEntryId,UUID sourceVersionId,int revision,String field,String title,String content,String origin,String status,List<Method> methods) {}
 public record Page(UUID tenantId,String mode,List<Knowledge> items) {}
 private final CompanyBackgroundSourceService sources;private final JdbcTemplate db;
 public BackgroundKnowledgeService(CompanyBackgroundSourceService sources,JdbcTemplate db){this.sources=sources;this.db=db;}
 @Transactional public Page list(UUID actor,UUID tenant){
  var source=sources.get(actor,tenant);var items=new ArrayList<Knowledge>();
  var methodsByEntry=new HashMap<UUID,List<Method>>();
  if(!source.entries().isEmpty()){
   var args=new ArrayList<Object>();args.add(tenant);
   for(var entry:source.entries())args.add(entry.id());
   args.add(actor);args.add(actor);
   String slots=String.join(",",Collections.nCopies(source.entries().size(),"?"));
   // Filter explicit dependencies first and check each referenced source once.
   // Keep the transaction's authorization locks; bounded work shortens their lifetime.
   db.query("""
    WITH dependencies AS MATERIALIZED (
     SELECT DISTINCT pv.entry_id,m.id,m.tenant_id,m.source_id,m.updated_at,v.version,v.definition
     FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.head_version
     JOIN profile_versions pv ON jsonb_exists(v.definition->'backgroundVersionIds',pv.id::text)
     WHERE m.tenant_id=? AND pv.entry_id IN (%s)
    ), targets AS MATERIALIZED (
     SELECT DISTINCT l.tenant_id,l.source_id,l.target_id,ds.workspace_id
     FROM dependencies d JOIN scene_asset_links l ON l.tenant_id=d.tenant_id AND l.source_id=d.source_id
      AND l.kind='TABLE' AND l.active
     JOIN business_datasets ds ON ds.id=l.target_id
    ), readable AS MATERIALIZED (
     SELECT * FROM targets WHERE file_dataset_readable(?,target_id)
      AND (library_mask(?,tenant_id,'WORKSPACE',workspace_id)&1)=1
    ), ranked AS (
     SELECT d.*,row_number() OVER(PARTITION BY d.entry_id ORDER BY d.updated_at DESC,d.id) AS position
     FROM dependencies d JOIN readable l ON l.tenant_id=d.tenant_id AND l.source_id=d.source_id
    )
    SELECT entry_id,id,version,definition->>'name' name,metric_background_current(id,version) current
    FROM ranked WHERE position<=21 ORDER BY entry_id,position
    """.formatted(slots),(org.springframework.jdbc.core.RowCallbackHandler)r->{
     var method=new Method(r.getObject("id",UUID.class),r.getInt("version"),r.getString("name"),r.getBoolean("current")?"REFERENCE_CURRENT":"REVIEW_REQUIRED");
     methodsByEntry.computeIfAbsent(r.getObject("entry_id",UUID.class),key->new ArrayList<>()).add(method);
    },args.toArray());
  }
  for(var entry:source.entries()){
   var methods=List.copyOf(methodsByEntry.getOrDefault(entry.id(),List.of()));
   items.add(new Knowledge("background:"+entry.id(),entry.id(),entry.versionId(),entry.revision(),entry.field().name(),entry.label(),entry.meaning(),entry.origin(),"REFERENCE_READY",methods));
  }
  return new Page(tenant,"STRUCTURED_REFERENCE",List.copyOf(items));
 }
}
