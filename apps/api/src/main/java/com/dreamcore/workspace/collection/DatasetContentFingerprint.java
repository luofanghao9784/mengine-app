package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Deterministic content, not an authorization cache. Preserves existing briefing deduplication keys. */
@Service
public class DatasetContentFingerprint {
 private final JdbcTemplate db;
 private final CollectionService collections;
 private final VersionedDatasetEvidence evidence;
 private final JsonMapper json=new JsonMapper();
 public DatasetContentFingerprint(JdbcTemplate db,CollectionService collections,VersionedDatasetEvidence evidence){this.db=db;this.collections=collections;this.evidence=evidence;}
 @Transactional public String key(UUID actor,UUID tenant,UUID dataset,UUID snapshot){
  if(!collections.readable(actor,tenant,dataset))throw new IdentityException(404,"DATASET_NOT_FOUND");
  var data=db.queryForMap("SELECT name,column_names,field_definitions,description FROM business_datasets WHERE tenant_id=? AND id=?",tenant,dataset);
  var metadata=List.of(data.get("name").toString(),data.get("column_names").toString(),data.get("field_definitions").toString(),data.get("description").toString());
  return (String)evidence.get(tenant,dataset,snapshot,"CONTENT_FINGERPRINT",metadata,()->{
   String raw=db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE tenant_id=? AND dataset_id=? AND id=? AND NOT scrubbed",String.class,tenant,dataset,snapshot);
   var rows=new ArrayList<String>();json.readTree(raw).forEach(row->rows.add(row.toString()));Collections.sort(rows);
   return Map.of("contentKey",IdentityService.hash(json.writeValueAsString(List.of(metadata.get(0),metadata.get(1),metadata.get(2),metadata.get(3),rows))));
  }).get("contentKey");
 }
}
