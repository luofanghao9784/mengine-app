package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class CollectionService {
    public record Schedule(boolean enabled,String frequency,String dailyTime,String timeZone) {}
    public record Run(UUID id,String triggerKind,String status,String reason,Instant createdAt,Instant startedAt,Instant finishedAt) {}
    public record Connection(UUID id,String name,String routeLabel,String accessSummary,String status,long revision,boolean canControl,
        Schedule schedule,Instant nextDue,Instant lastSuccessAt,Run currentRun,Run lastRun) {}
    public record Dataset(UUID id,UUID connectionId,UUID workspaceId,String workspaceName,String name,String description,
        List<String> columns,List<DatasetField> fieldDefinitions,Integer version,Integer rowCount,Instant collectedAt,Instant coverageThrough,Run latestRun) {}
    public record Summary(long datasets,long available,long updating,long failed) {}
    public record DataPage(List<Dataset> items,boolean hasMore) {}
    public record Preview(Dataset dataset,List<List<String>> rows,boolean hasMore) {}
    public record Claim(UUID tenantId,UUID connectionId,UUID runId,UUID token,long epoch,CollectionAdapter.Request request) {}
    private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;
    private final GovernanceAccess governance;private final MaterialAccess access;private final DepartureAccess departure;
    @org.springframework.beans.factory.annotation.Value("${dreamcore.collection.max-cells:4000000}") private long maxCells=4000000;
    private final CollectionAdapter adapter;private final JsonMapper json=new JsonMapper();
    @org.springframework.beans.factory.annotation.Autowired private CollectionSourceContracts sourceContracts;
    public CollectionService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,GovernanceAccess governance,MaterialAccess access,DepartureAccess departure,CollectionAdapter adapter) {
        this.db=db;this.identities=identities;this.audit=audit;this.governance=governance;this.access=access;this.departure=departure;this.adapter=adapter;
    }
    private static Instant instant(Object v){return v==null?null:((Timestamp)v).toInstant();}
    private static Timestamp stamp(Instant v){return v==null?null:Timestamp.from(v);}
    private static void bounds(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>100)throw IdentityException.invalid();}
    private boolean controls(UUID actor,UUID tenant){return governance.allows(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);}
    private void member(UUID actor,UUID tenant){identities.member(actor,tenant,false);if(!identities.supportAccess(actor,tenant))departure.requireActiveBusiness(actor,tenant);}
    private Map<String,Object> connection(UUID tenant,UUID connection,boolean lock) {
        var rows=db.queryForList("SELECT * FROM data_connections WHERE tenant_id=? AND id=?"+(lock?" FOR UPDATE":""),tenant,connection);
        if(rows.isEmpty())throw new IdentityException(404,"DATA_CONNECTION_NOT_FOUND");return rows.getFirst();
    }
    private boolean visible(UUID actor,UUID tenant,UUID connection){
        return (controls(actor,tenant)&&!fileConnection(tenant,connection))||Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM business_datasets d JOIN workspace_members g
              ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=headquarters_permission_actor(?,g.tenant_id)
              WHERE d.tenant_id=? AND d.connection_id=? AND d.status='ACTIVE' AND file_dataset_readable(g.account_id,d.id) AND (library_mask(g.account_id,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1)
            """,Boolean.class,actor,tenant,connection));
    }
    private Run run(Map<String,Object> row){return new Run((UUID)row.get("id"),(String)row.get("trigger_kind"),(String)row.get("status"),(String)row.get("reason"),instant(row.get("created_at")),instant(row.get("started_at")),instant(row.get("finished_at")));}
    private Run runById(UUID tenant,UUID connection,UUID id){var rows=db.queryForList("SELECT * FROM collection_runs WHERE tenant_id=? AND connection_id=? AND id=?",tenant,connection,id);if(rows.isEmpty())throw new IdentityException(404,"COLLECTION_RUN_NOT_FOUND");return run(rows.getFirst());}
    private Run latest(UUID connection,boolean active){var rows=db.queryForList("SELECT * FROM collection_runs WHERE connection_id=?"+(active?" AND status IN ('QUEUED','RUNNING')":"")+" ORDER BY created_at DESC,id DESC LIMIT 1",connection);return rows.isEmpty()?null:run(rows.getFirst());}
    private boolean fileConnection(UUID tenant,UUID connection){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM file_table_sources f JOIN business_datasets d ON d.id=f.dataset_id WHERE d.tenant_id=? AND d.connection_id=?)",Boolean.class,tenant,connection));}
    private String effectiveStatus(Map<String,Object> c){if(fileConnection((UUID)c.get("tenant_id"),(UUID)c.get("id")))return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM business_datasets d WHERE d.connection_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND file_dataset_current(d.id))",Boolean.class,c.get("id")))?"READY":"UNAVAILABLE";return "READY".equals(c.get("status"))&&!adapter.available()?"UNCONFIGURED":(String)c.get("status");}
    private Connection project(UUID actor,UUID tenant,Map<String,Object> c){
        UUID id=(UUID)c.get("id");String state=effectiveStatus(c);boolean control=controls(actor,tenant);
        String scope=control?(String)c.get("access_summary"):"当前获权空间："+String.join("、",db.queryForList("SELECT DISTINCT w.name FROM business_datasets d JOIN workspaces w ON w.id=d.workspace_id JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=headquarters_permission_actor(?,g.tenant_id) WHERE d.tenant_id=? AND d.connection_id=? AND d.status='ACTIVE' AND file_dataset_readable(g.account_id,d.id) AND (library_mask(g.account_id,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1 AND departure_content_readable(headquarters_permission_actor(?,d.tenant_id),d.tenant_id,d.workspace_id) ORDER BY w.name",String.class,actor,tenant,id,actor));
        Instant success=db.queryForObject("SELECT max(finished_at) FROM collection_runs WHERE connection_id=? AND status='SUCCEEDED'",(r,n)->instant(r.getTimestamp(1)),id);
        return new Connection(id,(String)c.get("name"),(String)c.get("route_label"),scope,state,((Number)c.get("revision")).longValue(),control,
            new Schedule((Boolean)c.get("auto_enabled"),(String)c.get("frequency"),(String)c.get("daily_time"),(String)c.get("time_zone")),"READY".equals(state)?instant(c.get("next_due")):null,success,latest(id,true),latest(id,false));
    }
    @Transactional public List<Connection> connections(UUID actor,UUID tenant){member(actor,tenant);return db.queryForList("SELECT * FROM data_connections WHERE tenant_id=? ORDER BY name,id",tenant).stream().filter(c->visible(actor,tenant,(UUID)c.get("id"))).map(c->project(actor,tenant,c)).toList();}
    @Transactional public Connection detail(UUID actor,UUID tenant,UUID connection){member(actor,tenant);var c=connection(tenant,connection,false);if(!visible(actor,tenant,connection))throw new IdentityException(404,"DATA_CONNECTION_NOT_FOUND");return project(actor,tenant,c);}
    @Transactional public List<Run> runs(UUID actor,UUID tenant,UUID connection,int offset,int limit){detail(actor,tenant,connection);bounds(offset,limit);return db.queryForList("SELECT * FROM collection_runs WHERE tenant_id=? AND connection_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",tenant,connection,limit,offset).stream().map(this::run).toList();}
    @Transactional public Connection configure(UUID actor,UUID tenant,UUID id,UUID request,long revision,Schedule schedule){
        member(actor,tenant);governance.require(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM file_table_sources f JOIN business_datasets d ON d.id=f.dataset_id WHERE d.connection_id=? AND d.tenant_id=?)",Boolean.class,id,tenant)))throw new IdentityException(409,"CONNECTION_UNAVAILABLE");
        if(schedule==null||revision<0)throw IdentityException.invalid();
        Instant now=Instant.now(),next=null;
        if(schedule.frequency()!=null)next=CollectionSchedule.next(now,schedule.frequency(),schedule.dailyTime(),schedule.timeZone());
        else if(schedule.enabled()||schedule.dailyTime()!=null)throw IdentityException.invalid();
        try{ZoneId.of(schedule.timeZone());}catch(Exception e){throw IdentityException.invalid();}
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,id,revision,schedule}));
        UUID prior=identities.priorRequest(actor,request,"COLLECTION_CONFIGURE",fingerprint);
        var c=connection(tenant,id,true);if(prior!=null)return project(actor,tenant,c);
        if(((Number)c.get("revision")).longValue()!=revision)throw new IdentityException(409,"COLLECTION_STATE_CHANGED");
        db.update("UPDATE data_connections SET auto_enabled=?,frequency=?,daily_time=?,time_zone=?,next_due=?,revision=revision+1,updated_at=? WHERE id=?",schedule.enabled(),schedule.frequency(),schedule.dailyTime(),schedule.timeZone(),schedule.enabled()?stamp(next):null,stamp(now),id);
        audit.record(actor,tenant,"COLLECTION_CONFIGURE",id,"SUCCESS");identities.remember(actor,request,"COLLECTION_CONFIGURE",fingerprint,id);
        return project(actor,tenant,connection(tenant,id,false));
    }
    @Transactional public Run updateNow(UUID actor,UUID tenant,UUID id,UUID request,long revision){
        departure.requireActiveBusiness(actor,tenant);
        member(actor,tenant);governance.require(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);
        if(fileConnection(tenant,id))throw new IdentityException(409,"CONNECTION_UNAVAILABLE");
        String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+revision);
        UUID prior=identities.priorRequest(actor,request,"COLLECTION_NOW",fingerprint);var c=connection(tenant,id,true);
        if(prior!=null)return runById(tenant,id,prior);
        if(((Number)c.get("revision")).longValue()!=revision)throw new IdentityException(409,"COLLECTION_STATE_CHANGED");
        if(!"READY".equals(effectiveStatus(c)))throw new IdentityException(409,"CONNECTION_UNAVAILABLE");
        if(db.queryForObject("SELECT count(*) FROM business_datasets WHERE connection_id=? AND status='ACTIVE'",Long.class,id)==0)throw new IdentityException(409,"DATASET_UNCONFIGURED");
        Run current=latest(id,true);UUID run=current==null?enqueue(tenant,id,actor,((Number)c.get("execution_epoch")).longValue(),Instant.now()):current.id();
        identities.remember(actor,request,"COLLECTION_NOW",fingerprint,run);if(current==null)audit.record(actor,tenant,"COLLECTION_NOW",id,"SUCCESS");return runById(tenant,id,run);
    }
    private UUID enqueue(UUID tenant,UUID connection,UUID actor,long epoch,Instant now){UUID id=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,requested_by,status,created_at) VALUES (?,?,?,?,?,?,'QUEUED',?)",id,tenant,connection,epoch,actor==null?"SCHEDULED":"MANUAL",actor,stamp(now));return id;}
    private boolean activeTenant(UUID tenant){var rows=db.queryForList("SELECT status FROM tenants WHERE id=? FOR SHARE",tenant);return !rows.isEmpty()&&"ACTIVE".equals(rows.getFirst().get("status"))&&!departure.exiting(tenant);}
    private String authority(Map<String,Object> r){
        UUID actor=(UUID)r.get("requested_by");if(actor==null)return null;
        var previous=com.dreamcore.workspace.support.SupportContext.current();
        try{var support= new com.dreamcore.workspace.support.SupportAccess(db);var context=support.forObject(actor,(UUID)r.get("tenant_id"),"collection_runs",(UUID)r.get("id"));
        com.dreamcore.workspace.support.SupportContext.set(context);
        if(context!=null)db.queryForObject("SELECT set_config('dreamcore.support_access',?,true)",String.class,context.id().toString());
        member(actor,(UUID)r.get("tenant_id"));return controls(actor,(UUID)r.get("tenant_id"))?null:"AUTHORIZATION_REVOKED";}catch(IdentityException e){return "AUTHORIZATION_REVOKED";}finally{com.dreamcore.workspace.support.SupportContext.set(previous);}
    }
    @Transactional public void schedule(UUID tenant,UUID id,Instant now){
        if(!activeTenant(tenant))return;var c=connection(tenant,id,true);
        if(!"READY".equals(effectiveStatus(c))||!Boolean.TRUE.equals(c.get("auto_enabled")))return;
        Instant due=instant(c.get("next_due"));if(due==null||due.isAfter(now))return;
        if(db.queryForObject("SELECT count(*) FROM business_datasets WHERE connection_id=? AND status='ACTIVE'",Long.class,id)==0)return;
        if(latest(id,true)==null)enqueue(tenant,id,null,((Number)c.get("execution_epoch")).longValue(),now);
        // One run covers the current tick; never replay every missed interval after downtime.
        Instant next=CollectionSchedule.next(now,(String)c.get("frequency"),(String)c.get("daily_time"),(String)c.get("time_zone"));
        db.update("UPDATE data_connections SET next_due=? WHERE id=?",stamp(next),id);
    }
    @Transactional public Claim claim(UUID tenant,UUID id,Instant now){
        if(!activeTenant(tenant))return null;var c=connection(tenant,id,true);
        var rows=db.queryForList("SELECT * FROM collection_runs WHERE connection_id=? AND status IN ('QUEUED','RUNNING') ORDER BY created_at,id LIMIT 1 FOR UPDATE",id);
        if(rows.isEmpty())return null;var r=rows.getFirst();UUID run=(UUID)r.get("id");String error=authority(r);
        if(!"READY".equals(effectiveStatus(c)))error="CONNECTION_UNAVAILABLE";
        if(((Number)c.get("execution_epoch")).longValue()!=((Number)r.get("execution_epoch")).longValue())error="DEPLOYMENT_CHANGED";
        if(error!=null){terminal(run,"INTERRUPTED",error,now);return null;}
        if("RUNNING".equals(r.get("status"))){if(!instant(r.get("lease_until")).isAfter(now))terminal(run,"FAILED","COLLECTION_LEASE_EXPIRED",now);return null;}
        UUID token=UUID.randomUUID();db.update("UPDATE collection_runs SET status='RUNNING',lease_token=?,lease_until=?,started_at=? WHERE id=?",token,stamp(now.plusSeconds(660)),stamp(now),run);
        var datasets=db.queryForList("SELECT id,dataset_key,column_names FROM business_datasets WHERE connection_id=? AND status='ACTIVE' ORDER BY id",id).stream()
            .map(d->new CollectionAdapter.Dataset((UUID)d.get("id"),(String)d.get("dataset_key"),strings(d.get("column_names")))).toList();
        if(datasets.isEmpty()){terminal(run,"FAILED","DATASET_UNCONFIGURED",now);return null;}
        return new Claim(tenant,id,run,token,((Number)c.get("execution_epoch")).longValue(),new CollectionAdapter.Request("1.0",tenant,id,run,datasets));
    }
    private List<String> strings(Object value){return json.readValue(value.toString(),json.getTypeFactory().constructCollectionType(List.class,String.class));}
    private void terminal(UUID run,String status,String reason,Instant now){db.update("UPDATE collection_runs SET status=?,reason=?,finished_at=?,lease_token=NULL,lease_until=NULL WHERE id=?",status,reason,stamp(now),run);}
    private boolean current(Claim claim,Instant now){
        boolean active=activeTenant(claim.tenantId());var c=connection(claim.tenantId(),claim.connectionId(),true);
        var rows=db.queryForList("SELECT * FROM collection_runs WHERE id=? AND connection_id=? AND status='RUNNING' AND lease_token=? FOR UPDATE",claim.runId(),claim.connectionId(),claim.token());
        if(rows.isEmpty())return false;var r=rows.getFirst();String error=authority(r);
        if(!active)error=departure.exiting(claim.tenantId())?"TENANT_EXITING":"TENANT_SERVICE_SUSPENDED";
        if(!"READY".equals(effectiveStatus(c)))error="CONNECTION_UNAVAILABLE";
        if(((Number)c.get("execution_epoch")).longValue()!=claim.epoch())error="DEPLOYMENT_CHANGED";
        if(!instant(r.get("lease_until")).isAfter(now))error="COLLECTION_LEASE_EXPIRED";
        if(error!=null){terminal(claim.runId(),"INTERRUPTED",error,now);return false;}return true;
    }
    @Transactional public boolean active(Claim claim){return current(claim,Instant.now());}
    @Transactional public void fail(Claim claim,String reason,Instant now){if(current(claim,now))terminal(claim.runId(),"FAILED",Set.of("COLLECTION_TIMEOUT","COLLECTION_INVALID_RESULT","COLLECTION_ADAPTER_FAILED").contains(reason)?reason:"COLLECTION_ADAPTER_FAILED",now);}
    @Transactional public boolean complete(Claim claim,CollectionAdapter.Result result,Instant now){
        if(!current(claim,now))return false;
        if(!valid(claim,result,now)){terminal(claim.runId(),"FAILED","COLLECTION_INVALID_RESULT",now);return false;}
        for(var snapshot:result.snapshots()) {
            var columns=claim.request().datasets().stream().filter(d->d.id().equals(snapshot.datasetId())).findFirst().orElseThrow().columns();
            if(!sourceContracts.valid(claim.tenantId(),snapshot,columns)) {
                terminal(claim.runId(),"FAILED","COLLECTION_SOURCE_CONTRACT_INVALID",now);return false;
            }
        }
        // Readers take shared dataset locks in database UUID order. Lock the whole
        // connection in that same order before inserting snapshots or updating pointers;
        // adapter response order must not become transaction lock order.
        db.queryForList("SELECT id FROM business_datasets WHERE tenant_id=? AND connection_id=? AND status='ACTIVE' ORDER BY id FOR UPDATE",claim.tenantId(),claim.connectionId());
        var waiting=new ArrayList<>(result.pending());
        boolean preflight=Arrays.stream(businessPreflightTenants.split(",")).anyMatch(t -> t.trim().equals(claim.tenantId().toString()));
        for(var snapshot:result.snapshots()){
            if(preflight) {
                var columns=claim.request().datasets().stream().filter(d -> d.id().equals(snapshot.datasetId())).findFirst().orElseThrow().columns();
                String state=SourceBusinessPreflight.check(snapshot,columns);
                if(!"READY".equals(state)) { waiting.add(new CollectionAdapter.Pending(snapshot.datasetId(),state)); continue; }
            }
            UUID id=UUID.randomUUID();Integer version=db.queryForObject("SELECT coalesce(max(version),0)+1 FROM dataset_snapshots WHERE dataset_id=?",Integer.class,snapshot.datasetId());
            db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,coverage_through,collected_at) VALUES (?,?,?,?,?,?,CAST(? AS jsonb),?,?,?)",id,claim.tenantId(),claim.connectionId(),snapshot.datasetId(),claim.runId(),version,json.writeValueAsString(snapshot.rows()),snapshot.rows().size(),stamp(snapshot.coverageThrough()),stamp(now));
            if(snapshot.exportReceipt()!=null)db.update("INSERT INTO collection_snapshot_receipts(snapshot_id,tenant_id,dataset_id,receipt,received_at) VALUES (?,?,?,?::jsonb,?)",id,claim.tenantId(),snapshot.datasetId(),CollectionReceiptChecks.stored(snapshot.exportReceipt(),id),stamp(now));
            if(snapshot.sourceContract()!=null)db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(snapshot.sourceContract()),id);
            db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=? AND tenant_id=? AND connection_id=? AND status='ACTIVE'",id,snapshot.datasetId(),claim.tenantId(),claim.connectionId());
            db.update("DELETE FROM collection_delivery_waits WHERE tenant_id=? AND dataset_id=?",claim.tenantId(),snapshot.datasetId());
        }
        for(var pending:waiting) db.update("INSERT INTO collection_delivery_waits(tenant_id,dataset_id,run_id,reason,checked_at) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,dataset_id) DO UPDATE SET run_id=excluded.run_id,reason=excluded.reason,checked_at=excluded.checked_at",claim.tenantId(),pending.datasetId(),claim.runId(),pending.reason(),stamp(now));
        terminal(claim.runId(),"SUCCEEDED",waiting.isEmpty()?null:"SOURCE_TABLES_WAITING",now);return true;
    }
    @org.springframework.beans.factory.annotation.Value("${dreamcore.collection.business-preflight-tenants:}") private String businessPreflightTenants="";
    private boolean valid(Claim claim,CollectionAdapter.Result result,Instant now){
        if(result==null||!"1.0".equals(result.contractVersion())||result.snapshots()==null||result.snapshots().size()+result.pending().size()!=claim.request().datasets().size())return false;
        var definitions=new HashMap<UUID,CollectionAdapter.Dataset>();claim.request().datasets().forEach(d->definitions.put(d.id(),d));
        var ids=new HashSet<UUID>();long totalCells=0;
        for(var s:result.snapshots()){
            if(s==null||!ids.add(s.datasetId())||!definitions.containsKey(s.datasetId())||s.rows()==null||s.rows().size()>100000||s.coverageThrough()!=null&&s.coverageThrough().isAfter(now))return false;
            var columns=definitions.get(s.datasetId()).columns();if(columns.isEmpty()||columns.size()>100||new HashSet<>(columns).size()!=columns.size())return false;
            for(var row:s.rows()){
                if(row==null||row.size()!=columns.size())return false;
                totalCells+=row.size();if(totalCells>Math.max(1,Math.min(10000000,maxCells)))return false;
                for(String cell:row)if(cell!=null&&cell.length()>8192)return false;
            }
            if(!CollectionReceiptChecks.valid(s,columns,now))return false;
        }
        for(var pending:result.pending()) if(pending==null || pending.reason()==null || !ids.add(pending.datasetId()) || !definitions.containsKey(pending.datasetId())
                || !Set.of("WAITING_SOURCE_DEFINITION","SOURCE_DATA_REQUIRES_REVIEW","SOURCE_COLLECTION_PENDING").contains(pending.reason())) return false;
        return true;
    }
    public List<Map<String,Object>> candidates(){return db.queryForList("SELECT c.tenant_id,c.id FROM data_connections c JOIN tenants t ON t.id=c.tenant_id WHERE t.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM departure_executions e WHERE e.tenant_id=c.tenant_id AND e.kind='TENANT_EXIT' AND e.state<>'CANCELLED') AND ((c.status='READY' AND c.auto_enabled AND c.next_due<=now()) OR EXISTS(SELECT 1 FROM collection_runs r WHERE r.connection_id=c.id AND (r.status='QUEUED' OR (r.status='RUNNING' AND r.lease_until<=now())))) ORDER BY c.next_due NULLS LAST,c.id LIMIT 100");}
    private Dataset dataset(Map<String,Object> d){
        UUID connection=(UUID)d.get("connection_id");return new Dataset((UUID)d.get("id"),connection,(UUID)d.get("workspace_id"),(String)d.get("workspace_name"),(String)d.get("name"),(String)d.get("description"),strings(d.get("column_names")),DatasetField.read(d.get("field_definitions")),(Integer)d.get("version"),(Integer)d.get("row_count"),instant(d.get("collected_at")),instant(d.get("coverage_through")),latest(connection,false));
    }
    private static final String DATASETS="""
        SELECT d.*,w.name AS workspace_name,s.version,s.row_count,s.collected_at,s.coverage_through
        FROM business_datasets d JOIN workspaces w ON w.tenant_id=d.tenant_id AND w.id=d.workspace_id
        JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=headquarters_permission_actor(?,g.tenant_id)
        LEFT JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=d.current_snapshot
        LEFT JOIN LATERAL (SELECT status FROM collection_runs r WHERE r.connection_id=d.connection_id ORDER BY created_at DESC,id DESC LIMIT 1) latest_run ON true
        WHERE d.tenant_id=? AND d.status='ACTIVE' AND file_dataset_readable(g.account_id,d.id) AND (library_mask(g.account_id,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1 AND departure_content_readable(headquarters_permission_actor(?,d.tenant_id),d.tenant_id,d.workspace_id)
        """;
    @Transactional public Summary summary(UUID actor,UUID tenant){
        member(actor,tenant);
        String query=DATASETS.replace("SELECT d.*,w.name AS workspace_name,s.version,s.row_count,s.collected_at,s.coverage_through", "SELECT count(*) AS datasets,count(s.id) AS available,count(*) FILTER(WHERE latest_run.status IN ('QUEUED','RUNNING')) AS updating,count(*) FILTER(WHERE latest_run.status IN ('FAILED','INTERRUPTED')) AS failed");
        return db.queryForObject(query,(r,n)->new Summary(r.getLong(1),r.getLong(2),r.getLong(3),r.getLong(4)),actor,tenant,actor);
    }
    @Transactional public DataPage datasets(UUID actor,UUID tenant,String query,int offset,int limit){return datasets(actor,tenant,query,"",offset,limit);}
    @Transactional public DataPage datasets(UUID actor,UUID tenant,String query,String state,int offset,int limit){
        member(actor,tenant);bounds(offset,limit);if(query==null||query.length()>160||!Set.of("","AVAILABLE","UPDATING","FAILED","EMPTY").contains(state))throw IdentityException.invalid();
        String filter=switch(state){case "AVAILABLE"->" AND s.id IS NOT NULL";case "UPDATING"->" AND latest_run.status IN ('QUEUED','RUNNING')";case "FAILED"->" AND latest_run.status IN ('FAILED','INTERRUPTED')";case "EMPTY"->" AND s.id IS NULL";default->"";};
        var rows=db.queryForList(DATASETS+filter+" AND (?='' OR strpos(lower(d.name),lower(?))>0) ORDER BY d.name,d.id LIMIT ? OFFSET ?",actor,tenant,actor,query,query,limit+1,offset);
        return new DataPage(rows.stream().limit(limit).map(this::dataset).toList(),rows.size()>limit);
    }
    /** Catalog probing must not swallow a transactional access exception and poison the caller transaction. */
    @Transactional public boolean readable(UUID actor,UUID tenant,UUID id){
        member(actor,tenant);return !db.queryForList(DATASETS+" AND d.id=?",actor,tenant,actor,id).isEmpty();
    }
    @Transactional public Preview preview(UUID actor,UUID tenant,UUID id,int offset,int limit){
        member(actor,tenant);bounds(offset,limit);var rows=db.queryForList(DATASETS+" AND d.id=?",actor,tenant,actor,id);
        if(rows.isEmpty())throw new IdentityException(404,"DATASET_NOT_FOUND");var d=rows.getFirst();access.require(actor,tenant,(UUID)d.get("workspace_id"),false);
        var values=d.get("current_snapshot")==null?List.<List<String>>of():db.query("SELECT item FROM dataset_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.data_rows) WITH ORDINALITY AS r(item,position) WHERE s.dataset_id=? AND s.id=? ORDER BY position LIMIT ? OFFSET ?",(r,n)->strings(r.getObject(1)),id,d.get("current_snapshot"),limit+1,offset);
        return new Preview(dataset(d),values.stream().limit(limit).toList(),values.size()>limit);
    }
}
