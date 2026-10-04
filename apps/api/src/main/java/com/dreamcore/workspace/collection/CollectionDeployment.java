package com.dreamcore.workspace.collection;
import java.nio.file.*;
import java.time.ZoneId;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import com.dreamcore.workspace.identity.IdentityAudit;
import tools.jackson.databind.json.JsonMapper;
/** Invoked only by the host CLI, with operator DB configuration. No public deployment endpoint. */
@Component
public class CollectionDeployment {
    public record Dataset(UUID id,UUID workspaceId,String key,String name,String description,List<String> columns){}
    public record Manifest(String contractVersion,UUID tenantId,UUID connectionId,String name,String routeLabel,String accessSummary,String status,String timeZone,List<Dataset> datasets){}
    private final JdbcTemplate db;private final TransactionTemplate tx;private final Environment env;private final IdentityAudit audit;
    private final JsonMapper json=new JsonMapper();
    public CollectionDeployment(JdbcTemplate db,TransactionTemplate tx,Environment env,IdentityAudit audit){this.db=db;this.tx=tx;this.env=env;this.audit=audit;}
    public void run()throws Exception{
        Path file=Path.of(env.getRequiredProperty("COLLECTION_MANIFEST_FILE"));
        if(!file.isAbsolute()||!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||Files.size(file)>131072)throw new IllegalArgumentException("Invalid collection manifest file");
        apply(json.readValue(Files.readString(file),Manifest.class));
    }
    private void text(String value,int max){if(value==null||value.isBlank()||value.length()>max||value.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException("Invalid deployment metadata");}
    public void apply(Manifest m){
        if(m==null||!"1.0".equals(m.contractVersion())||m.tenantId()==null||m.connectionId()==null||m.datasets()==null||m.datasets().size()>100||!Set.of("READY","UNAVAILABLE","UNCONFIGURED").contains(m.status()))throw new IllegalArgumentException("Invalid deployment manifest");
        text(m.name(),160);text(m.routeLabel(),500);text(m.accessSummary(),1000);ZoneId.of(m.timeZone());
        var ids=new HashSet<UUID>();var keys=new HashSet<String>();
        for(var d:m.datasets()){
            if(d==null||d.id()==null||d.workspaceId()==null||!ids.add(d.id())||!keys.add(d.key())||d.columns()==null||d.columns().isEmpty()||d.columns().size()>100||new HashSet<>(d.columns()).size()!=d.columns().size())throw new IllegalArgumentException("Invalid dataset definition");
            text(d.key(),160);text(d.name(),160);if(d.description()==null||d.description().length()>1000)throw new IllegalArgumentException("Invalid description");for(var column:d.columns())text(column,160);
        }
        tx.executeWithoutResult(status->{
            if(db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",m.tenantId()).isEmpty())throw new IllegalArgumentException("Unknown enterprise");
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM departure_executions WHERE tenant_id=? AND kind='TENANT_EXIT' AND state<>'CANCELLED')",Boolean.class,m.tenantId())))throw new IllegalArgumentException("Enterprise exit blocks collection deployment");
            var existing=db.queryForList("SELECT tenant_id FROM data_connections WHERE id=? FOR UPDATE",m.connectionId());
            if(!existing.isEmpty()&&!m.tenantId().equals(existing.getFirst().get("tenant_id")))throw new IllegalArgumentException("Connection belongs to another enterprise");
            if(existing.isEmpty())db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,?,?,?,?,?)",m.connectionId(),m.tenantId(),m.name(),m.routeLabel(),m.accessSummary(),m.status(),m.timeZone());
            else db.update("UPDATE data_connections SET name=?,route_label=?,access_summary=?,status=?,revision=revision+1,execution_epoch=execution_epoch+1,updated_at=now() WHERE id=?",m.name(),m.routeLabel(),m.accessSummary(),m.status(),m.connectionId());
            db.update("UPDATE collection_runs SET status='INTERRUPTED',reason='DEPLOYMENT_CHANGED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE connection_id=? AND status IN ('QUEUED','RUNNING')",m.connectionId());
            for(UUID id:db.queryForList("SELECT id FROM business_datasets WHERE connection_id=? AND status='ACTIVE'",UUID.class,m.connectionId()))if(!ids.contains(id))db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",id);
            for(var d:m.datasets()){
                if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM workspaces WHERE tenant_id=? AND id=? AND kind='SHARED')",Boolean.class,m.tenantId(),d.workspaceId())))throw new IllegalArgumentException("Dataset needs an existing shared workspace");
                var prior=db.queryForList("SELECT * FROM business_datasets WHERE id=?",d.id());
                if(prior.isEmpty())db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,description,column_names) VALUES (?,?,?,?,?,?,?,CAST(? AS jsonb))",d.id(),m.tenantId(),m.connectionId(),d.workspaceId(),d.key(),d.name(),d.description(),json.writeValueAsString(d.columns()));
                else {
                    var p=prior.getFirst();
                    if(!m.connectionId().equals(p.get("connection_id"))||!d.workspaceId().equals(p.get("workspace_id"))||!d.key().equals(p.get("dataset_key"))||!json.readTree(p.get("column_names").toString()).equals(json.valueToTree(d.columns())))throw new IllegalArgumentException("Scope and columns require a new dataset identity");
                    db.update("UPDATE business_datasets SET name=?,description=?,status='ACTIVE' WHERE id=?",d.name(),d.description(),d.id());
                }
            }
            audit.record(null,m.tenantId(),"COLLECTION_DEPLOY",m.connectionId(),"SUCCESS");
        });
    }
}
