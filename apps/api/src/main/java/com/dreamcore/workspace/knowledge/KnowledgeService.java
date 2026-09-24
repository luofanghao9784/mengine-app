package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KnowledgeService {
    public record Chunk(UUID id,UUID tenantId,UUID workspaceId,UUID materialId,UUID versionId,UUID runId,int version,String filename,String locator,String method,String content) {}
    public record Analysis(UUID tenantId,UUID workspaceId,UUID materialId,UUID versionId,int generation,String status,String parserVersion,List<String> warnings,boolean canMaintain,boolean available,List<Chunk> chunks,boolean hasMore) {}
    public record Results(UUID tenantId,UUID workspaceId,String query,List<Chunk> items,boolean hasMore) {}
    public record Job(UUID id,UUID tenant,UUID workspace,UUID material,UUID version,UUID actor,UUID token) {}
    public record Input(String filename,byte[] bytes) {}
    private final JdbcTemplate db; private final MaterialAccess access; private final IdentityService identities;
    private final IdentityAudit audit; private final ObjectStore store; private final boolean enabled;
    public KnowledgeService(JdbcTemplate db,MaterialAccess access,IdentityService identities,IdentityAudit audit,ObjectStore store,@Value("${dreamcore.knowledge.enabled:false}") boolean enabled) {
        this.db=db;this.access=access;this.identities=identities;this.audit=audit;this.store=store;this.enabled=enabled;
    }
    private IdentityException missing() { return new IdentityException(404,"KNOWLEDGE_NOT_FOUND"); }
    private void page(int offset,int limit) { if(offset<0 || offset>100000 || limit<1 || limit>50) throw IdentityException.invalid(); }
    private Map<String,Object> version(UUID tenant,UUID space,UUID material,UUID version,boolean lock) {
        var rows=db.queryForList("SELECT * FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND id=?"+(lock?" FOR UPDATE":""),tenant,space,material,version);
        if(rows.isEmpty()) throw missing(); return rows.getFirst();
    }
    private List<Map<String,Object>> latest(UUID version) { return db.queryForList("SELECT * FROM knowledge_runs WHERE version_id=? ORDER BY generation DESC LIMIT 1",version); }
    private static final String SELECT="""
        SELECT c.*,v.number,v.filename FROM knowledge_chunks c JOIN material_versions v
        ON v.id=c.version_id AND v.tenant_id=c.tenant_id AND v.workspace_id=c.workspace_id AND v.material_id=c.material_id
        """;
    private final RowMapper<Chunk> mapper=(r,n)->new Chunk(r.getObject("id",UUID.class),r.getObject("tenant_id",UUID.class),r.getObject("workspace_id",UUID.class),r.getObject("material_id",UUID.class),r.getObject("version_id",UUID.class),r.getObject("run_id",UUID.class),r.getInt("number"),r.getString("filename"),r.getString("locator"),r.getString("method"),r.getString("content"));
    @Transactional
    public Analysis analysis(UUID actor,UUID tenant,UUID space,UUID material,UUID version,int offset,int limit) {
        page(offset,limit);var permission=access.require(actor,tenant,space,false);version(tenant,space,material,version,false);
        var rows=latest(version); var chunks=List.<Chunk>of();
        if(rows.isEmpty()) return new Analysis(tenant,space,material,version,0,"NOT_STARTED",null,List.of(),permission.canMaintain(),enabled,chunks,false);
        var row=rows.getFirst();String status=(String)row.get("status"),warnings=(String)row.get("warnings");
        if(Set.of("READY","PARTIAL").contains(status)) chunks=db.query(SELECT+" WHERE c.tenant_id=? AND c.workspace_id=? AND c.run_id=? ORDER BY c.ordinal LIMIT ? OFFSET ?",mapper,tenant,space,row.get("id"),limit+1,offset);
        return new Analysis(tenant,space,material,version,(Integer)row.get("generation"),status,(String)row.get("parser_version"),warnings.isBlank()?List.of():List.of(warnings.split(",")),permission.canMaintain(),enabled,chunks.stream().limit(limit).toList(),chunks.size()>limit);
    }
    /** Called in the upload transaction, after the immutable version is inserted. */
    @Transactional
    public void onUpload(UUID actor,UUID tenant,UUID space,UUID material,UUID version) {
        if(enabled) { access.require(actor,tenant,space,true);enqueue(actor,tenant,space,material,version,1); }
    }
    private UUID enqueue(UUID actor,UUID tenant,UUID space,UUID material,UUID version,int generation) {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,?,?,'QUEUED')",id,tenant,space,material,version,generation,actor);
        audit.record(actor,tenant,"KNOWLEDGE_QUEUE",id,"SUCCESS");return id;
    }
    @Transactional
    public Analysis request(UUID actor,UUID tenant,UUID space,UUID material,UUID version,UUID key,int expectedGeneration) {
        String fingerprint=IdentityService.hash(tenant+"\n"+space+"\n"+material+"\n"+version+"\n"+expectedGeneration);
        UUID prior=identities.priorRequest(actor,key,"KNOWLEDGE_PARSE",fingerprint);
        access.require(actor,tenant,space,true);version(tenant,space,material,version,true);
        if(prior!=null) return analysis(actor,tenant,space,material,version,0,20);
        if(!enabled) throw new IdentityException(503,"KNOWLEDGE_UNAVAILABLE");
        var rows=latest(version);int generation=rows.isEmpty()?0:(Integer)rows.getFirst().get("generation");
        if(expectedGeneration!=generation || (!rows.isEmpty() && Set.of("QUEUED","RUNNING").contains(rows.getFirst().get("status")))) throw new IdentityException(409,"KNOWLEDGE_GENERATION_CONFLICT");
        UUID id=enqueue(actor,tenant,space,material,version,generation+1);identities.remember(actor,key,"KNOWLEDGE_PARSE",fingerprint,id);
        return analysis(actor,tenant,space,material,version,0,20);
    }
    @Transactional
    public Results search(UUID actor,UUID tenant,UUID space,String query,int offset,int limit) {return search(actor,tenant,space,query,offset,limit,null);}
    @Transactional public Results search(UUID actor,UUID tenant,UUID space,String query,int offset,int limit,List<UUID> selectedVersions) {
        if(selectedVersions!=null && (space==null || selectedVersions.isEmpty() || selectedVersions.size()>3 || selectedVersions.stream().anyMatch(Objects::isNull)))throw IdentityException.invalid();
        page(offset,limit); identities.member(actor,tenant,false);if(space!=null) access.require(actor,tenant,space,false);
        query=query.strip();if(query.isEmpty() || query.length()>200) throw IdentityException.invalid();
        String[] terms=query.split("\\s+");if(terms.length>8) throw IdentityException.invalid();
        String sql=SELECT+"""
            JOIN workspaces w ON w.id=c.workspace_id AND w.tenant_id=c.tenant_id
            JOIN materials m ON m.id=c.material_id AND m.tenant_id=c.tenant_id AND m.workspace_id=c.workspace_id
            JOIN knowledge_runs r ON r.id=c.run_id AND r.status IN ('READY','PARTIAL')
            LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            WHERE c.tenant_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM knowledge_runs newer WHERE newer.version_id=r.version_id AND newer.generation>r.generation)
            """;
        var args=new ArrayList<Object>(List.of(actor,tenant,actor));
        if(selectedVersions==null)sql+=" AND m.current_version=v.number";
        else {sql+=" AND c.version_id IN ("+String.join(",",Collections.nCopies(selectedVersions.size(),"?"))+")";args.addAll(selectedVersions);}
        if(space==null) sql+=" AND w.kind='SHARED'";else { sql+=" AND c.workspace_id=?";args.add(space); }
        for(String term:terms) {sql+=" AND strpos(lower(c.content),lower(?))>0";args.add(term);}
        sql+=" ORDER BY r.created_at DESC,c.ordinal,c.id LIMIT ? OFFSET ?";args.add(limit+1);args.add(offset);
        db.execute("SET LOCAL statement_timeout='3s'");
        var found=db.query(sql,mapper,args.toArray());return new Results(tenant,space,query,found.stream().limit(limit).toList(),found.size()>limit);
    }
    @Transactional
    public Chunk citation(UUID actor,UUID tenant,UUID id) {
        identities.member(actor,tenant,false);
        var rows=db.query(SELECT+" WHERE c.tenant_id=? AND c.id=?",mapper,tenant,id);if(rows.isEmpty()) throw missing();
        var chunk=rows.getFirst();access.require(actor,tenant,chunk.workspaceId(),false);return chunk;
    }
    @Transactional
    public Job claim() {
        db.update("UPDATE knowledge_runs SET status='FAILED',warnings='WORKER_RETRY_LIMIT',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE status='RUNNING' AND lease_until<now() AND attempts>=3");
        var rows=db.queryForList("SELECT * FROM knowledge_runs WHERE status='QUEUED' OR (status='RUNNING' AND lease_until<now() AND attempts<3) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
        if(rows.isEmpty()) return null;var row=rows.getFirst();UUID token=UUID.randomUUID(),id=(UUID)row.get("id");
        db.update("UPDATE knowledge_runs SET status='RUNNING',attempts=attempts+1,lease_token=?,lease_until=now()+interval '120 seconds' WHERE id=?",token,id);
        return new Job(id,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("material_id"),(UUID)row.get("version_id"),(UUID)row.get("requested_by"),token);
    }
    private boolean owned(Job job) { return !db.queryForList("SELECT id FROM knowledge_runs WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() FOR UPDATE",job.id(),job.token()).isEmpty(); }
    @Transactional
    public Input input(Job job) {
        access.require(job.actor(),job.tenant(),job.workspace(),true);if(!owned(job)) return null;
        var v=version(job.tenant(),job.workspace(),job.material(),job.version(),false);
        return new Input((String)v.get("filename"),store.read((UUID)v.get("object_id"),(Long)v.get("size_bytes"),(String)v.get("sha256")));
    }
    @Transactional
    public void finish(Job job,DocumentParser.Result result) {
        access.require(job.actor(),job.tenant(),job.workspace(),true);if(!owned(job)) return;
        int ordinal=0;
        for(var c:result.chunks()) db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,?,?,?,?)",UUID.randomUUID(),job.tenant(),job.workspace(),job.material(),job.version(),job.id(),ordinal++,c.locator(),c.method(),c.content());
        db.update("UPDATE knowledge_runs SET status=?,parser_version=?,warnings=?,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=?",result.status(),result.parserVersion(),String.join(",",result.warnings()),job.id());
        audit.record(job.actor(),job.tenant(),"KNOWLEDGE_FINISH",job.id(),Set.of("READY","PARTIAL").contains(result.status())?"SUCCESS":"FAILURE");
    }
    @Transactional
    public void abandon(Job job,boolean permission) {
        db.update("UPDATE knowledge_runs SET status=?,warnings=?,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=? AND status='RUNNING' AND lease_token=?",permission?"CANCELLED":"FAILED",permission?"ACCESS_CHANGED":"PARSER_UNAVAILABLE_OR_LIMIT",job.id(),job.token());
    }
}
