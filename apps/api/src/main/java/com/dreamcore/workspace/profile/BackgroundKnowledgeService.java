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
  for(var entry:source.entries()){
   var methods=db.query("""
    SELECT m.id,v.version,v.definition->>'name' name,metric_background_current(m.id,v.version) current
    FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.head_version
    JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
    JOIN business_datasets ds ON ds.id=l.target_id
    WHERE m.tenant_id=? AND file_dataset_readable(?,l.target_id)
      AND (library_mask(?,m.tenant_id,'WORKSPACE',ds.workspace_id)&1)=1
      AND EXISTS(SELECT 1 FROM profile_versions pv WHERE pv.entry_id=? AND jsonb_exists(v.definition->'backgroundVersionIds',pv.id::text))
    ORDER BY m.updated_at DESC,m.id LIMIT 21
    """,(r,n)->new Method(r.getObject("id",UUID.class),r.getInt("version"),r.getString("name"),r.getBoolean("current")?"REFERENCE_CURRENT":"REVIEW_REQUIRED"),tenant,actor,actor,entry.id());
   items.add(new Knowledge("background:"+entry.id(),entry.id(),entry.versionId(),entry.revision(),entry.field().name(),entry.label(),entry.meaning(),entry.origin(),"REFERENCE_READY",methods));
  }
  return new Page(tenant,"STRUCTURED_REFERENCE",List.copyOf(items));
 }
}
