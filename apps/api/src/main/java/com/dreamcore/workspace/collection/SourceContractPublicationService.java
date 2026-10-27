package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.governance.GovernanceModelService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

/** Publishes collector definitions after independent current-batch checks. */
@Service
public class SourceContractPublicationService {
    private final JdbcTemplate db;
    private final NativeGovernanceDeployment releases;
    private final GovernanceModelService governance;
    @org.springframework.beans.factory.annotation.Autowired private VersionedDatasetEvidence evidenceReceipts;
    @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.knowledge.KnowledgePipelineProgress progress;
    private boolean defer(UUID tenant,UUID dataset,String reason){progress.record(tenant,dataset,"DEFINITION","WAITING",reason);return false;}
    private boolean ready(UUID tenant,UUID dataset){progress.record(tenant,dataset,"DEFINITION","SUCCEEDED","PUBLISHED");return true;}
    public boolean due(UUID tenant,UUID dataset){return progress.due(tenant,dataset,"DEFINITION");}
    public void failed(UUID tenant,UUID dataset){progress.record(tenant,dataset,"DEFINITION","FAILED","PROCESSING_FAILED");}
    private final JsonMapper json=new JsonMapper();
    public SourceContractPublicationService(JdbcTemplate db, NativeGovernanceDeployment releases, GovernanceModelService governance) {
        this.db=db;this.releases=releases;this.governance=governance;
    }
    @Transactional(isolation=Isolation.REPEATABLE_READ)
    public boolean reconcile(UUID actor,UUID tenant,UUID dataset) {
        // Match governance publication/briefing lock order: tenant before any dataset row.
        if(db.queryForList("SELECT id FROM tenants WHERE id=? AND status='ACTIVE' FOR UPDATE",tenant).isEmpty()) return false;
        if(!db.queryForList("SELECT dataset_id FROM collection_delivery_waits WHERE tenant_id=? AND dataset_id=?",tenant,dataset).isEmpty()) return defer(tenant,dataset,"SOURCE_DELIVERY_WAITING");
        var source=json.valueToTree(governance.currentDatasetSource(actor,tenant,dataset));
        var checks=source.path("checks");
        if(!"CHECKED".equals(checks.path("sourceContract").path("state").asText())) return defer(tenant,dataset,"SOURCE_DEFINITION_REQUIRED");
        if(!"CHECKED".equals(checks.path("exportValidation").path("state").asText())) return defer(tenant,dataset,"SOURCE_RECEIPT_REQUIRED");
        if(!"CHECKED".equals(checks.path("state").asText())) return defer(tenant,dataset,"SOURCE_VALIDATION_FAILED");
        var rows=db.queryForList("SELECT r.source_contract::text,s.id snapshot_id,d.column_names::text FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot AND s.dataset_id=d.id JOIN collection_snapshot_receipts r ON r.snapshot_id=s.id AND r.tenant_id=d.tenant_id AND r.dataset_id=d.id WHERE d.tenant_id=? AND d.id=? AND NOT d.scrubbed AND NOT s.scrubbed FOR UPDATE OF d",tenant,dataset);
        if(rows.isEmpty()) return defer(tenant,dataset,"SOURCE_DEFINITION_REQUIRED");
        var row=rows.getFirst();
        var contract=json.readValue(row.get("source_contract").toString(),CollectionAdapter.SourceContract.class);
        List<String> columns=json.readValue(row.get("column_names").toString(),List.class);
        UUID snapshot=(UUID)row.get("snapshot_id");
        var preflight=evidenceReceipts.get(tenant,dataset,snapshot,"PREFLIGHT",List.of("preflight-v3",contract,columns),()->{
            List<List<String>> values=json.readValue(db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE tenant_id=? AND dataset_id=? AND id=? AND NOT scrubbed",String.class,tenant,dataset,snapshot),List.class);
            return Map.of("state",SourceBusinessPreflight.check(new CollectionAdapter.Snapshot(dataset,null,values,null,contract),columns));
        });
        if(!"READY".equals(preflight.get("state"))) return defer(tenant,dataset,preflight.get("state").toString());
        var fields=fields(contract,columns);
        // Reuse a current fully documented release; currentFor also checks definition/background drift.
        if(releases.currentFor(actor,tenant,dataset).stream().anyMatch(p -> !p.fields().isEmpty() && p.fields().stream().allMatch(f -> Set.of("SOURCE_DOCUMENTED","MODEL_DETERMINED","DEPLOYMENT_INFERRED").contains(f.status())))) return ready(tenant,dataset);
        var context=releases.definitionContext(actor,tenant,List.of(dataset));
        var item=new NativeGovernanceDeployment.Item(dataset,context.sources().getFirst().token(),fields,"",List.of("采集端来源定义第 "+contract.definitionVersion()+" 版；本批导出接收及已声明规则独立核验通过"));
        var identity=json.writeValueAsString(List.of(tenant,actor,context.backgroundVersion(),item));
        UUID id=UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8));
        releases.submit(new NativeGovernanceDeployment.Package("1.2",id,tenant,actor,context.backgroundVersion(),List.of(item)),true);
        db.update("INSERT INTO source_contract_publications(release_id,tenant_id,dataset_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",id,tenant,dataset);
        return ready(tenant,dataset);
    }
    public static List<DatasetField> fields(CollectionAdapter.SourceContract contract,List<String> columns) {
        var body=new JsonMapper().readTree(contract.definitionJson());
        var fields=new ArrayList<DatasetField>();
        for(String column:columns) {
            var matches=new ArrayList<tools.jackson.databind.JsonNode>();
            for(var entry:body.path("entries")) if(column.equals(entry.path("column").asText()) && "BUSINESS_DEFINITION".equals(entry.path("definitionScope").asText())) matches.add(entry);
            if(matches.size()!=1) throw new IllegalArgumentException("Ambiguous source definition");
            var entry=matches.getFirst();
            if(!entry.path("declaredUnit").isString()) throw new IllegalArgumentException("Source unit is not declared");
            String type=null;
            for(var rule:body.path("schema")) if("value-rule".equals(rule.path("kind").asText()) && column.equals(rule.path("column").asText())) {
                String mapped=switch(rule.path("type").asText()) {case "DECIMAL" -> "decimal";case "DATE" -> "date";default -> "text";};
                if(type!=null && !type.equals(mapped)) throw new IllegalArgumentException("Conflicting source types");
                type=mapped;
            }
            String meaning=entry.path("sourceMetadata").path("definition").asText();
            String evidence="";
            for(var proof:entry.path("proof")) {
                String value=proof.path("snippet").asText(proof.path("locator").asText());
                if(!value.isBlank() && value.length()<=300) {evidence=value;break;}
            }
            fields.add(new DatasetField(column,type,meaning,entry.path("declaredUnit").asText(),evidence,"MODEL_DETERMINED".equals(entry.path("status").asText()) ? "MODEL_DETERMINED" : evidence.isBlank() ? "DEPLOYMENT_INFERRED" : "SOURCE_DOCUMENTED"));
        }
        DatasetField.validate(columns,fields);
        return List.copyOf(fields);
    }
}
