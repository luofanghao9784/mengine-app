package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import jakarta.servlet.http.HttpServletResponse;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/conversations/{conversation}/tasks/{task}/background-evidence")
public class BackgroundEvidenceController {
 private final ConversationService conversations;private final JdbcTemplate db;
 public BackgroundEvidenceController(ConversationService conversations,JdbcTemplate db){this.conversations=conversations;this.db=db;}
 @GetMapping @Transactional public Object get(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@PathVariable UUID task,HttpServletResponse response){
  response.setHeader("Cache-Control","private, no-store");
  // Reuse the existing private conversation, source and successful-result gates.
  var detail=conversations.historical(UUID.fromString(auth.getName()),tenant,conversation,task);
  int attempt=detail.tasks().getFirst().attempt();
  var profiles=db.queryForList("SELECT r.reference_id AS \"entryId\",r.version_key AS revision,pv.value::jsonb->>'label' AS title FROM task_context_reads r JOIN company_information_tags tag ON tag.profile_id=r.reference_id AND tag.tenant_id=? JOIN profile_versions pv ON pv.entry_id=r.reference_id AND pv.revision::text=r.version_key WHERE r.task_id=? AND r.attempt_number=? AND r.kind='PROFILE' ORDER BY r.reference_id",tenant,task,attempt);
  var calculations=db.queryForList("SELECT v.definition->>'name' AS name,c.metric_id AS \"metricId\",c.version,c.dataset_id AS \"datasetId\",c.snapshot_id AS \"snapshotId\",coalesce(v.definition->'backgroundVersionIds','[]'::jsonb)::text AS \"backgroundVersions\" FROM metric_calculation_receipts c JOIN scene_metric_versions v ON v.metric_id=c.metric_id AND v.version=c.version WHERE c.task_id=? AND c.attempt_number=? ORDER BY c.created_at LIMIT 100",task,attempt);
  var knowledge=db.queryForList("SELECT DISTINCT v.filename AS title,v.number AS version FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id JOIN material_versions v ON v.id=c.version_id JOIN conversation_attempts a ON a.attempt_id=g.attempt_id WHERE g.task_id=? AND a.attempt_number=? ORDER BY v.filename,v.number",task,attempt);
  var mapper=new tools.jackson.databind.json.JsonMapper();
  var reconciliations=db.queryForList("SELECT body::text FROM task_reconciliation_receipts WHERE task_id=? AND attempt_number=? ORDER BY receipt_id",String.class,task,attempt).stream().map(raw->{var body=mapper.readTree(raw);return Map.of("receiptId",body.path("receiptId").asText(),"period",body.at("/calculation/period"),"amounts",body.at("/calculation/result/amounts"),"sourceCount",body.at("/calculation/inputs").size());}).toList();
  return Map.of("taskId",task,"attempt",attempt,"profiles",profiles,"calculations",calculations,"knowledge",knowledge,"reconciliations",reconciliations);
 }
}
