package com.dreamcore.workspace.analysis;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Internal pool contract. Only server-generated deterministic calculations enter this slice.
 * No model endpoint, scheduler, implicit publication, or cross-owner read is installed here. */
@Service
public class CalculationMaterialService {
    public record Version(UUID materialId, UUID versionId, int number, String state,
                          Instant generatedAt, Instant validUntil, Instant checkedAt,
                          Instant coverageThrough, UUID observedSnapshotId, JsonNode content) {}
    private final JdbcTemplate db;
    private final MaterialAccess access;
    private final IdentityService identities;
    private final JsonMapper json = new JsonMapper();
    public CalculationMaterialService(JdbcTemplate db, MaterialAccess access, IdentityService identities) {
        this.db=db; this.access=access; this.identities=identities;
    }
    private IdentityException missing() { return new IdentityException(404,"ANALYSIS_MATERIAL_UNAVAILABLE"); }
    private Instant instant(Object value) { return value==null?null:((Timestamp)value).toInstant(); }
    private Map<String,Object> one(List<Map<String,Object>> rows) {
        if(rows.size()!=1) throw missing(); return rows.getFirst();
    }
    private void member(UUID actor, UUID tenant) {
        identities.member(actor,tenant,false);
        // A privileged support identity must not silently stand in for a private task owner.
        if(identities.supportAccess(actor,tenant)) throw missing();
    }
    private Map<String,Object> evidence(UUID actor, UUID tenant, UUID artifact) {
        var e=one(db.queryForList("""
            SELECT a.*,t.requested_by,t.status,t.attempt,t.workspace_id task_workspace,proof.created_at computed_at
            FROM conversation_artifacts a JOIN conversation_tasks t ON t.id=a.task_id
            JOIN readable_source_tasks readable ON readable.id=t.id
            JOIN analysis_computation_receipts proof ON proof.artifact_id=a.id AND proof.sha256=a.sha256
            WHERE a.id=? AND a.tenant_id=? AND t.tenant_id=? AND t.requested_by=?
              AND t.status='SUCCEEDED' AND a.attempt_number=t.attempt
              AND object_is_active('ARTIFACT',a.id)
              AND NOT EXISTS(SELECT 1 FROM task_dataset_fences f WHERE f.task_id=t.id AND f.attempt_number=t.attempt)
            FOR SHARE OF a,t
            """,artifact,tenant,tenant,actor));
        access.require(actor,tenant,(UUID)e.get("task_workspace"),false);
        byte[] bytes=(byte[])e.get("content");
        if(!IdentityService.hash(new String(bytes,StandardCharsets.UTF_8)).equals(e.get("sha256"))) throw missing();
        return e;
    }
    private Map<String,Object> snapshot(UUID actor,UUID tenant,UUID dataset,UUID snapshot) {
        // Share lock fences concurrent source withdrawal, snapshot replacement and erasure.
        var s=one(db.queryForList("""
            SELECT s.*,d.column_names,d.workspace_id,d.current_snapshot
            FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id
            WHERE d.id=? AND d.tenant_id=? AND s.tenant_id=? AND s.id=coalesce(?::uuid,d.current_snapshot)
              AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
            FOR SHARE OF d,s
            """,dataset,tenant,tenant,snapshot));
        access.require(actor,tenant,(UUID)s.get("workspace_id"),false);
        return s;
    }
    /** Row order is immaterial for the supported aggregation recipes; duplicates remain significant. */
    private String fingerprint(Map<String,Object> s) {
        var rows=json.readTree(s.get("data_rows").toString());
        if(!rows.isArray() || rows.size()!=((Number)s.get("row_count")).intValue()) throw missing();
        var sorted=new ArrayList<String>(); rows.forEach(row->sorted.add(row.toString()));
        Collections.sort(sorted);
        return IdentityService.hash(json.writeValueAsString(List.of(json.readTree(s.get("column_names").toString()),sorted)));
    }
    /** Import is explicit, idempotent by artifact, and never accepts model-supplied content/evidence. */
    @Transactional
    public Version retain(UUID actor,UUID tenant,UUID artifact,UUID material,int expectedVersion,Instant validUntil) {
        if(artifact==null || material==null || expectedVersion<0 || validUntil==null) throw IdentityException.invalid();
        member(actor,tenant);
        // A tenant-local lock serializes first insertion and version CAS; it is not an execution grant.
        db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,"analysis:"+tenant);
        var evidence=evidence(actor,tenant,artifact);
        var content=json.readTree((byte[])evidence.get("content"));
        var calculation=content.path("calculation");
        String recipe=calculation.path("recipeVersion").asString("");
        if(!Set.of("dataset-compare-1","dataset-compare-month-1","dataset-summary-1","dataset-composition-1").contains(recipe)
            || !"COMPUTED".equals(calculation.path("status").asString(""))
            || !((String)evidence.get("filename")).startsWith("dataset-comparison-")) throw missing();
        var normalizedRequest=json.readValue(calculation.path("request").toString(),java.util.TreeMap.class);
        normalizedRequest.remove("snapshotId");
        String requestFingerprint=IdentityService.hash(json.writeValueAsString(normalizedRequest));
        UUID dataset,original;
        try {
            dataset=UUID.fromString(content.path("datasetSource").path("datasetId").asString(""));
            original=UUID.fromString(content.path("datasetSource").path("snapshotId").asString(""));
        } catch(IllegalArgumentException ex) { throw missing(); }
        var source=snapshot(actor,tenant,dataset,original);
        String inputHash=IdentityService.hash(source.get("column_names")+"\n"+source.get("data_rows"));
        if(!inputHash.equals(calculation.path("inputSha256").asString(""))
            || !inputHash.equals(content.path("datasetSource").path("sha256").asString(""))) throw missing();
        if(!Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM task_dataset_reads WHERE task_id=? AND attempt_number=? AND dataset_id=? AND snapshot_id=?)
            """,Boolean.class,evidence.get("task_id"),evidence.get("attempt"),dataset,original))) throw missing();
        var prior=db.queryForList("SELECT material_id,number FROM analysis_material_versions WHERE tenant_id=? AND artifact_id=?",tenant,artifact);
        if(!prior.isEmpty()) {
            var p=prior.getFirst();
            if(!material.equals(p.get("material_id"))) throw IdentityException.conflict();
            return read(actor,tenant,material,((Number)p.get("number")).intValue(),false);
        }
        if(!validUntil.isAfter(Instant.now()) || validUntil.isAfter(instant(evidence.get("computed_at")).plusSeconds(31L*86400))) throw IdentityException.invalid();
        var roots=db.queryForList("SELECT * FROM analysis_materials WHERE id=? FOR UPDATE",material);
        if(roots.isEmpty()) {
            if(expectedVersion!=0) throw IdentityException.conflict();
            db.update("INSERT INTO analysis_materials(id,tenant_id,owner_id) VALUES (?,?,?)",material,tenant,actor);
        } else {
            var root=roots.getFirst();
            if(!tenant.equals(root.get("tenant_id")) || !actor.equals(root.get("owner_id"))) throw missing();
            if(((Number)root.get("current_version")).intValue()!=expectedVersion) throw IdentityException.conflict();
            if(!requestFingerprint.equals(db.queryForObject("SELECT request_fingerprint FROM analysis_material_versions WHERE material_id=? AND number=?",String.class,material,expectedVersion)))
                throw new IdentityException(409,"ANALYSIS_MATERIAL_SCOPE_CHANGED");
        }
        UUID version=UUID.randomUUID();
        db.update("""
            INSERT INTO analysis_material_versions(id,tenant_id,material_id,number,artifact_id,source_task_id,
              dataset_id,snapshot_id,input_fingerprint,artifact_sha256,request_fingerprint,recipe_version,generated_at,valid_until)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,version,tenant,material,expectedVersion+1,artifact,evidence.get("task_id"),dataset,original,
            fingerprint(source),evidence.get("sha256"),requestFingerprint,recipe,evidence.get("computed_at"),Timestamp.from(validUntil));
        db.update("UPDATE analysis_materials SET current_version=? WHERE id=?",expectedVersion+1,material);
        return read(actor,tenant,material,expectedVersion+1,false);
    }
    /** Cache miss is normal. Each candidate is reauthorized and compared with the pinned whole dataset. */
    @Transactional public Optional<Version> reusable(UUID actor,UUID tenant,Object request,UUID dataset,UUID pinned){
        member(actor,tenant);
        var normalized=json.readValue(json.writeValueAsString(request),TreeMap.class);normalized.remove("snapshotId");
        String key=IdentityService.hash(json.writeValueAsString(normalized));
        String fixed=fingerprint(snapshot(actor,tenant,dataset,pinned));
        for(var candidate:db.queryForList("SELECT m.id,v.number,v.input_fingerprint FROM analysis_materials m JOIN analysis_material_versions v ON v.material_id=m.id AND v.number=m.current_version WHERE m.tenant_id=? AND m.owner_id=? AND v.request_fingerprint=? AND v.valid_until>now() ORDER BY v.generated_at DESC LIMIT 8",tenant,actor,key)){
            if(!fixed.equals(candidate.get("input_fingerprint")))continue;
            try{return Optional.of(forUse(actor,tenant,(UUID)candidate.get("id"),((Number)candidate.get("number")).intValue(),Instant.now().minusSeconds(7200)));}
            catch(IdentityException unavailable){/* A revoked, expired or changed entry is never a hit. */}
        }
        return Optional.empty();
    }
    /** Usage requires a server-selected business cutoff, not merely a recent generation timestamp.
     * Call inside the consumer transaction, and again in its final commit fence. */
    @Transactional
    public Version forUse(UUID actor,UUID tenant,UUID material,int number,Instant requiredCoverageThrough) {
        if(requiredCoverageThrough==null || requiredCoverageThrough.isAfter(Instant.now())) throw IdentityException.invalid();
        var version=read(actor,tenant,material,number,true);
        if(version.coverageThrough()==null) throw new IdentityException(409,"ANALYSIS_COVERAGE_UNKNOWN");
        if(version.coverageThrough().isBefore(requiredCoverageThrough)) throw new IdentityException(409,"ANALYSIS_COVERAGE_TOO_OLD");
        return version;
    }
    /** CURRENT means same content as the latest available dataset, not real-time business freshness.
     * All reads recheck access and data, even for an already observed snapshot. */
    @Transactional
    public Version read(UUID actor,UUID tenant,UUID material,int number,boolean requireCurrent) {
        if(material==null || number<1) throw IdentityException.invalid();
        member(actor,tenant);
        var v=one(db.queryForList("""
            SELECT v.*,m.current_version FROM analysis_material_versions v
            JOIN analysis_materials m ON m.id=v.material_id
            WHERE v.tenant_id=? AND m.owner_id=? AND m.id=? AND v.number=? FOR SHARE OF m
            """,tenant,actor,material,number));
        var e=evidence(actor,tenant,(UUID)v.get("artifact_id"));
        if(!e.get("sha256").equals(v.get("artifact_sha256"))) throw missing();
        snapshot(actor,tenant,(UUID)v.get("dataset_id"),(UUID)v.get("snapshot_id"));
        var current=snapshot(actor,tenant,(UUID)v.get("dataset_id"),null);
        String fingerprint=fingerprint(current);
        String observation=fingerprint.equals(v.get("input_fingerprint"))?"UNCHANGED":"CHANGED";
        db.update("""
            INSERT INTO analysis_material_observations(id,tenant_id,version_id,dataset_id,snapshot_id,coverage_through,input_fingerprint,result)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(version_id,snapshot_id) DO NOTHING
            """,UUID.randomUUID(),tenant,v.get("id"),v.get("dataset_id"),current.get("id"),current.get("coverage_through"),fingerprint,observation);
        var checked=db.queryForMap("SELECT checked_at FROM analysis_material_observations WHERE version_id=? AND snapshot_id=?",v.get("id"),current.get("id"));
        String state=number!=((Number)v.get("current_version")).intValue()?"SUPERSEDED":
            !instant(v.get("valid_until")).isAfter(Instant.now())?"EXPIRED":observation.equals("CHANGED")?"STALE":"CURRENT";
        if(requireCurrent&&!state.equals("CURRENT")) throw new IdentityException(409,"ANALYSIS_MATERIAL_"+state);
        return new Version(material,(UUID)v.get("id"),number,state,instant(v.get("generated_at")),instant(v.get("valid_until")),
            instant(checked.get("checked_at")),instant(current.get("coverage_through")),(UUID)current.get("id"),json.readTree((byte[])e.get("content")));
    }
}
