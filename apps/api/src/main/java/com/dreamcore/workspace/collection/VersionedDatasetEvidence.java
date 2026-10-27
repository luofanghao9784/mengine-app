package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Internal memo of deterministic evidence. Callers MUST authorize before every read. */
@Service
public class VersionedDatasetEvidence {
 private final JdbcTemplate db;
 private final JsonMapper json=new JsonMapper();
 public VersionedDatasetEvidence(JdbcTemplate db){this.db=db;}
 @Transactional
 public Map<String,Object> get(UUID tenant,UUID dataset,UUID snapshot,String kind,Object input,Supplier<Map<String,Object>> calculate){
  if(!Set.of("CHECKS","PREFLIGHT","INSIGHT_FACTS").contains(kind))throw new IllegalArgumentException("Evidence kind");
  // Keep the snapshot stable through insertion. Scrub waits, then deletes this receipt too.
  if(db.queryForList("SELECT s.id FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.id=? AND s.id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed FOR SHARE OF s",UUID.class,tenant,dataset,snapshot).isEmpty())throw new IdentityException(404,"DATASET_NOT_FOUND");
  String hash=IdentityService.hash(json.writeValueAsString(input));
  var cached=db.queryForList("SELECT payload::text FROM dataset_evidence_receipts WHERE tenant_id=? AND dataset_id=? AND snapshot_id=? AND kind=? AND input_hash=?",String.class,tenant,dataset,snapshot,kind,hash);
  if(!cached.isEmpty())return json.readValue(cached.getFirst(),Map.class);
  var value=calculate.get();
  db.update("INSERT INTO dataset_evidence_receipts(tenant_id,dataset_id,snapshot_id,kind,input_hash,payload) VALUES (?,?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING",tenant,dataset,snapshot,kind,hash,json.writeValueAsString(value));
  return value;
 }
}
