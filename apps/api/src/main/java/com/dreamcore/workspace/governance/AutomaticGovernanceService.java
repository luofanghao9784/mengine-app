package com.dreamcore.workspace.governance;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import com.dreamcore.workspace.identity.IdentityException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

/** Reconciles one frozen version. Failed/uncertain paid attempts need explicit operator retry. */
@Service
public class AutomaticGovernanceService {
 private final JdbcTemplate db; private final GovernanceModelService jobs; private final JsonMapper json=new JsonMapper();
 public AutomaticGovernanceService(JdbcTemplate db,GovernanceModelService jobs){this.db=db;this.jobs=jobs;}
 @Transactional(isolation=Isolation.REPEATABLE_READ)
 public boolean reconcile(UUID actor,UUID tenant,String kind,UUID source) {
  if(!Set.of("DATASET","MATERIAL").contains(kind))return false;
  // Taking the same tenant lock as native publication prevents opposing lock order in this transaction.
  if(db.queryForList("SELECT id FROM tenants WHERE id=? AND status='ACTIVE' FOR UPDATE",tenant).isEmpty())return false;
  var context=jobs.automaticSource(actor,tenant,kind,source);
  if("MATERIAL".equals(kind)&&!"READY".equals(context.get("parserStatus")))return false;
  String basis=jobs.sourceHash(context);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","automatic-governance:"+tenant+":"+kind+":"+source);
  // A new semantic policy may replace completed legacy preparation, never an uncertain paid attempt.
  UUID request=UUID.nameUUIDFromBytes(("semantic-review-v2:"+tenant+":"+actor+":"+kind+":"+source+":"+basis).getBytes(StandardCharsets.UTF_8));
  var prior=db.queryForList("SELECT j.id,j.request_id,j.state,j.revision,j.input::text,j.output::text,d.state dispatch_state FROM governance_model_jobs j LEFT JOIN governance_model_dispatch d ON d.job_id=j.id WHERE j.tenant_id=? AND j.actor_id=? AND j.kind=? AND j.source_id=? AND j.basis_hash=? ORDER BY j.created_at DESC,j.id DESC FOR UPDATE OF j",tenant,actor,kind,source,basis);
  var manualPreparation=new ArrayList<Map<String,Object>>();
  for(var job:prior) {
   var input=json.readTree(job.get("input").toString());
   boolean nativeAttempt="2.0".equals(input.path("contractVersion").asText()) || job.get("dispatch_state")!=null;
   if(!nativeAttempt) { manualPreparation.add(job);continue; }
   Map<String,Object> output=job.get("output")==null?Map.of():json.readValue(job.get("output").toString(),Map.class);
   boolean completed="DRAFT_READY".equals(job.get("state"))&&"SUCCEEDED".equals(job.get("dispatch_state"));
   // Current-policy completion (even malformed) is terminal for automatic billing. Only an
   // older successfully completed call that predates qualityReview can get one new policy job.
   if(completed && !output.containsKey("qualityReview") && !request.equals(job.get("request_id")))continue;
   if(completed) {
    try { jobs.validateQualityReview(output,context); }
    catch(IdentityException invalidReview) { return false; } // Retain completion; never replay paid work.
    if("USABLE".equals(((Map<?,?>)output.get("qualityReview")).get("state")))
     jobs.publish(actor,tenant,(UUID)job.get("id"),new GovernanceModelService.Publish(((Number)job.get("revision")).intValue(),input.path("inputHash").asText()));
   }
   return false;
  }
  if(db.queryForObject("SELECT count(*) FROM governance_model_dispatch WHERE state IN ('PENDING','WAITING_MODEL','RUNNING')",Integer.class)>=32)return false;
  // Legacy 1.0 preparation never opened a dispatcher/paid attempt. Preserve its input and
  // history, but release start()'s same-source busy gate before queuing the new policy.
  for(var job:manualPreparation)if(Set.of("WAITING_MODEL","VALIDATING").contains(job.get("state"))) {
   int changed=db.update("UPDATE governance_model_jobs SET state='STALE',revision=revision+1,error_code='SEMANTIC_POLICY_SUPERSEDED',updated_at=now() WHERE id=? AND state IN ('WAITING_MODEL','VALIDATING')",job.get("id"));
   if(changed==1)db.update("INSERT INTO governance_model_events(job_id,state,revision,code) VALUES (?,'STALE',?,'SEMANTIC_POLICY_SUPERSEDED')",job.get("id"),((Number)job.get("revision")).intValue()+1);
  }
  jobs.execute(actor,tenant,new GovernanceModelService.Execute(request,kind,source,"SYSTEM_MODEL"));
  return true;
 }
}
