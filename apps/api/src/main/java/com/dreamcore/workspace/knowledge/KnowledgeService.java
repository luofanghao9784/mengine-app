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
    public record VersionCoverage(UUID materialId,UUID versionId,int version,UUID runId,int generation,String status,List<String> warnings,boolean pinned) {}
    public record Coverage(String scope,String status,long totalVersions,long searchableVersions,long partialVersions,long notReadyVersions,
                           String relevance,List<VersionCoverage> versions,boolean hasMore) {
        public Coverage limited(int limit){return new Coverage(scope,status,totalVersions,searchableVersions,partialVersions,notReadyVersions,relevance,versions.stream().limit(limit).toList(),hasMore || versions.size()>limit);}
    }
    public record Results(UUID tenantId,UUID workspaceId,String query,List<Chunk> items,boolean hasMore,String matchStatus,Coverage coverage) {}
    public record Job(UUID id,UUID tenant,UUID workspace,UUID material,UUID version,UUID actor,UUID token) {}
    public record Input(String filename,byte[] bytes) {}
    private final FileTableService fileTables;
    private final WeKnoraRetrieval retrieval;
    private final JdbcTemplate db; private final MaterialAccess access; private final IdentityService identities;
    private final IdentityAudit audit; private final ObjectStore store; private final boolean enabled;
    private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
    public KnowledgeService(JdbcTemplate db,MaterialAccess access,IdentityService identities,IdentityAudit audit,ObjectStore store,FileTableService fileTables,WeKnoraRetrieval retrieval,@Value("${dreamcore.knowledge.enabled:false}") boolean enabled) {
        this.retrieval=retrieval;this.fileTables=fileTables;this.db=db;this.access=access;this.identities=identities;this.audit=audit;this.store=store;this.enabled=enabled;
    }
    private IdentityException missing() { return new IdentityException(404,"KNOWLEDGE_NOT_FOUND"); }
    private void page(int offset,int limit) { if(offset<0 || offset>100000 || limit<1 || limit>50) throw IdentityException.invalid(); }
    private Map<String,Object> version(UUID tenant,UUID space,UUID material,UUID version,boolean lock) {
        access.requireVersionActive(tenant,space,version);
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
        page(offset,limit);var permission=access.requireObject(actor,tenant,space,"MATERIAL",material,false);version(tenant,space,material,version,false);
        audit.record(actor,tenant,"MATERIAL_PREVIEW",version,"SUCCESS");var rows=latest(version); var chunks=List.<Chunk>of();
        if(rows.isEmpty()) return new Analysis(tenant,space,material,version,0,"NOT_STARTED",null,List.of(),permission.canMaintain(),enabled,chunks,false);
        var row=rows.getFirst();String status=(String)row.get("status"),warnings=(String)row.get("warnings");
        if(Set.of("READY","PARTIAL").contains(status)) chunks=db.query(SELECT+" WHERE c.tenant_id=? AND c.workspace_id=? AND c.run_id=? ORDER BY c.ordinal LIMIT ? OFFSET ?",mapper,tenant,space,row.get("id"),limit+1,offset);
        return new Analysis(tenant,space,material,version,(Integer)row.get("generation"),status,(String)row.get("parser_version"),warnings.isBlank()?List.of():List.of(warnings.split(",")),permission.canMaintain(),enabled,chunks.stream().limit(limit).toList(),chunks.size()>limit);
    }
    /** Called in the upload transaction, after the immutable version is inserted. */
    @Transactional
    public void onUpload(UUID actor,UUID tenant,UUID space,UUID material,UUID version) {
        if(enabled) { access.requireObject(actor,tenant,space,"MATERIAL",material,true);enqueue(actor,tenant,space,material,version,1); }
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
        access.requireObject(actor,tenant,space,"MATERIAL",material,true);version(tenant,space,material,version,true);
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
        return search(actor,tenant,space,query,offset,limit,selectedVersions,null,null,false,null);
    }
    /** Only the platform's authorized attempt callback supplies task/attempt; no public request selects them. */
    @Transactional public Results searchForAttempt(UUID actor,UUID tenant,UUID space,String query,int limit,List<UUID> selectedVersions,UUID task,UUID attempt) {
        if(task==null || attempt==null || space==null)throw IdentityException.invalid();
        return search(actor,tenant,space,query,0,limit,selectedVersions,task,attempt,false,null);
    }
    @Transactional public Results searchClientTask(UUID actor,UUID tenant,UUID space,String query,int limit,List<UUID> selectedVersions,UUID task,UUID attempt,UUID conversation){
        return search(actor,tenant,space,query,0,limit,selectedVersions,task,attempt,true,conversation);
    }
    private Results search(UUID actor,UUID tenant,UUID space,String suppliedQuery,int offset,int limit,List<UUID> selectedVersions,UUID task,UUID attempt,boolean library,UUID conversation) {
        if(selectedVersions!=null && (selectedVersions.isEmpty() || selectedVersions.size()>3 || selectedVersions.stream().anyMatch(Objects::isNull)))throw IdentityException.invalid();
        page(offset,limit); identities.member(actor,tenant,false);if(space!=null) access.require(actor,tenant,space,false);
        if(suppliedQuery==null)throw IdentityException.invalid();
        String query=suppliedQuery.strip();if((query.isEmpty() && (task==null || selectedVersions==null)) || query.length()>200) throw IdentityException.invalid();
        String[] terms=query.isEmpty()?new String[0]:query.split("\\s+");if(terms.length>8) throw IdentityException.invalid();
        var args=new ArrayList<Object>();args.add(task);args.add(attempt);args.add(task);args.add(identities.permissionActor(actor,tenant));args.add(tenant);args.add(identities.permissionActor(actor,tenant));
        String scope="""
            SELECT v.*,r.id AS run_id,coalesce(r.status,'NOT_STARTED') AS parse_status,
                   coalesce(r.generation,0) AS generation,coalesce(r.warnings,'') AS warnings,
                   r.created_at AS run_created_at,(pin.task_id IS NOT NULL) AS pinned,(requested.task_id IS NOT NULL) AS selected
            FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id
            LEFT JOIN conversation_task_material_versions pin ON pin.task_id=? AND pin.attempt_id=?
              AND pin.tenant_id=m.tenant_id AND pin.workspace_id=m.workspace_id AND pin.material_id=m.id
            LEFT JOIN conversation_originals requested ON requested.task_id=? AND requested.tenant_id=m.tenant_id AND requested.material_id=m.id
            JOIN material_versions v ON v.material_id=m.id AND v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id
            LEFT JOIN LATERAL (
              SELECT k.* FROM knowledge_runs k WHERE k.version_id=v.id AND (pin.run_id IS NULL OR k.id=pin.run_id)
              ORDER BY k.generation DESC LIMIT 1
            ) r ON true
            LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            WHERE m.tenant_id=? AND (library_mask(?,w.tenant_id,'MATERIAL',m.id)&1)=1
            """;
        if(selectedVersions==null)scope+=" AND ((pin.version_id IS NULL AND requested.version_id IS NULL AND m.current_version=v.number) OR coalesce(pin.version_id,requested.version_id)=v.id)";
        else {scope+=" AND v.id IN ("+String.join(",",Collections.nCopies(selectedVersions.size(),"?"))+")";args.addAll(selectedVersions);}
        if(!library){if(space==null)scope+=" AND w.kind='SHARED'";else {scope+=" AND m.workspace_id=?";args.add(space);}}
        if(selectedVersions==null){scope+=" AND (m.in_library OR m.attachment_conversation_id=?::uuid OR requested.version_id=v.id)";args.add(conversation);}

        boolean overview=query.isEmpty()&&selectedVersions!=null;
        List<UUID> ranked=null;
        if(retrieval.enabled() && !overview){
            if(offset+limit>100)throw new IdentityException(503,"KNOWLEDGE_SEARCH_SCOPE_LIMIT");
            ranked=retrieval.search(scope,new ArrayList<>(args),query,Math.min(offset+limit+1,100));
            // HTTP work can outlive permission changes. Re-read membership and authorization below.
            identities.member(actor,tenant,false);if(space!=null)access.require(actor,tenant,space,false);
        }
        String ranking="0";
        if(ranked!=null && !ranked.isEmpty()){
            var order=new StringBuilder("CASE c.id ");
            for(int i=0;i<ranked.size();i++)order.append("WHEN '").append(ranked.get(i)).append("'::uuid THEN ").append(i).append(' ');
            ranking=order.append("ELSE 100 END").toString();
        }
        String match="SELECT c.*,s.number,s.filename,s.run_created_at,s.selected,"+ranking+" AS retrieval_rank,"+(overview?"row_number() OVER(PARTITION BY c.version_id ORDER BY c.ordinal,c.id)":"0")+" AS excerpt_round FROM knowledge_chunks c JOIN scoped s ON c.run_id=s.run_id AND c.version_id=s.id AND c.tenant_id=s.tenant_id AND c.workspace_id=s.workspace_id WHERE s.parse_status IN ('READY','PARTIAL')";
        if(ranked==null){for(String term:terms){match+=" AND strpos(lower(c.content),lower(?))>0";args.add(term);}}
        else if(ranked.isEmpty())match+=" AND false";
        else {match+=" AND c.id IN ("+String.join(",",Collections.nCopies(ranked.size(),"?"))+")";args.addAll(ranked);}
        args.add(limit+1);args.add(offset);
        // One snapshot covers authorization-filtered totals, the bounded version receipt and the result page.
        // A not-yet-parsed file is scope coverage, never a claim that it is relevant to the query.
        // A selected-file overview visits each version before taking its next excerpt.
        String sql="WITH scoped AS MATERIALIZED ("+scope+"),matched AS MATERIALIZED ("+match+"), page AS (SELECT * FROM matched ORDER BY selected DESC,retrieval_rank,excerpt_round,run_created_at DESC,ordinal,id LIMIT ? OFFSET ?) "+"""
            SELECT count(*) AS total,
              count(*) FILTER(WHERE parse_status IN ('READY','PARTIAL')) AS searchable,
              count(*) FILTER(WHERE parse_status='PARTIAL') AS partial,
              EXISTS(SELECT 1 FROM matched) AS has_match,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id',p.id,'tenantId',p.tenant_id,'workspaceId',p.workspace_id,'materialId',p.material_id,
                'versionId',p.version_id,'runId',p.run_id,'version',p.number,'filename',p.filename,
                'locator',p.locator,'method',p.method,'content',p.content) ORDER BY p.selected DESC,p.retrieval_rank,p.excerpt_round,p.run_created_at DESC,p.ordinal,p.id) FROM page p),'[]') AS items,
              coalesce((SELECT jsonb_agg(jsonb_build_object(
                'materialId',v.material_id,'versionId',v.id,'version',v.number,'runId',v.run_id,'generation',v.generation,
                'status',v.parse_status,'warnings',CASE WHEN v.warnings='' THEN ARRAY[]::text[] ELSE string_to_array(v.warnings,',') END,
                'pinned',v.pinned) ORDER BY v.material_id,v.number)
                FROM (SELECT * FROM scoped ORDER BY material_id,number LIMIT 100) v),'[]') AS versions
            FROM scoped
            """;
        db.execute("SET LOCAL statement_timeout='3s'");
        return db.queryForObject(sql,(r,n)->{
            long total=r.getLong("total"),searchable=r.getLong("searchable"),partial=r.getLong("partial");
            String state=total==0?"EMPTY":searchable==0?"NOT_READY":searchable<total || partial>0?"PARTIAL":"READY";
            var found=Arrays.asList(json.readValue(r.getString("items"),Chunk[].class));
            var versions=Arrays.stream(json.readValue(r.getString("versions"),VersionCoverage[].class))
                .map(v->new VersionCoverage(v.materialId(),v.versionId(),v.version(),v.runId(),v.generation(),v.status(),
                    v.warnings().stream().limit(4).map(w->w.substring(0,Math.min(64,w.length()))).toList(),v.pinned())).toList();
            var coverage=new Coverage(selectedVersions!=null?"SELECTED_VERSIONS":library?"AUTHORIZED_LIBRARY":space==null?"AUTHORIZED_SHARED":"AUTHORIZED_WORKSPACE",
                state,total,searchable,partial,total-searchable,"NOT_ASSESSED",versions,total>versions.size());
            return new Results(tenant,space,query,found.stream().limit(limit).toList(),found.size()>limit,r.getBoolean("has_match")?"MATCHED":"NO_MATCH",coverage);
        },args.toArray());
    }
    @Transactional
    public Chunk citation(UUID actor,UUID tenant,UUID id) {
        identities.member(actor,tenant,false);
        var rows=db.query(SELECT+" WHERE c.tenant_id=? AND c.id=?",mapper,tenant,id);if(rows.isEmpty()) throw missing();
        var chunk=rows.getFirst();access.requireObject(actor,tenant,chunk.workspaceId(),"MATERIAL",chunk.materialId(),false);access.requireVersionActive(tenant,chunk.workspaceId(),chunk.versionId());audit.record(actor,tenant,"MATERIAL_CITATION_READ",chunk.versionId(),"SUCCESS");return chunk;
    }
    @Transactional
    public Job claim() {
        // Imported scene outputs can be superseded before parsing starts. Preserve receipts,
        // but do not let obsolete automatic versions starve current input or explicit reparses.
        db.update("""
          UPDATE knowledge_runs r SET status='CANCELLED',warnings='SOURCE_VERSION_SUPERSEDED',finished_at=now()
          FROM material_versions v JOIN materials m ON m.id=v.material_id
          WHERE r.version_id=v.id AND r.status='QUEUED' AND r.generation=1 AND r.attempts=0
           AND v.number<>m.current_version
           AND EXISTS(SELECT 1 FROM scene_asset_links l WHERE l.tenant_id=r.tenant_id AND l.target_id=m.id AND l.kind IN ('DOCUMENT','KNOWLEDGE'))
          """);
        db.update("UPDATE knowledge_runs SET status='FAILED',warnings='WORKER_RETRY_LIMIT',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE status='RUNNING' AND lease_until<now() AND attempts>=3");
        var rows=db.queryForList("SELECT * FROM knowledge_runs WHERE status='QUEUED' OR (status='RUNNING' AND lease_until<now() AND attempts<3) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
        if(rows.isEmpty()) return null;var row=rows.getFirst();UUID token=UUID.randomUUID(),id=(UUID)row.get("id");
        db.update("UPDATE knowledge_runs SET status='RUNNING',attempts=attempts+1,lease_token=?,lease_until=now()+interval '120 seconds' WHERE id=?",token,id);
        return new Job(id,(UUID)row.get("tenant_id"),(UUID)row.get("workspace_id"),(UUID)row.get("material_id"),(UUID)row.get("version_id"),(UUID)row.get("requested_by"),token);
    }
    private boolean owned(Job job) { return !db.queryForList("SELECT id FROM knowledge_runs WHERE id=? AND status='RUNNING' AND lease_token=? AND lease_until>now() FOR UPDATE",job.id(),job.token()).isEmpty(); }
    @Transactional
    public Input input(Job job) {
        new com.dreamcore.workspace.support.SupportAccess(db).bindObject(job.actor(),job.tenant(),"knowledge_runs",job.id());
        if(!owned(job)) return null;access.requireObject(job.actor(),job.tenant(),job.workspace(),"MATERIAL",job.material(),true);
        var v=version(job.tenant(),job.workspace(),job.material(),job.version(),false);
        return new Input((String)v.get("filename"),store.read((UUID)v.get("object_id"),(Long)v.get("size_bytes"),(String)v.get("sha256")));
    }
    @Transactional
    public void finish(Job job,DocumentParser.Result result) {
        new com.dreamcore.workspace.support.SupportAccess(db).bindObject(job.actor(),job.tenant(),"knowledge_runs",job.id());
        if(!owned(job)) return;access.requireObject(job.actor(),job.tenant(),job.workspace(),"MATERIAL",job.material(),true);
        access.requireVersionActive(job.tenant(),job.workspace(),job.version());
        int ordinal=0;
        for(var c:result.chunks()) db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,?,?,?,?)",UUID.randomUUID(),job.tenant(),job.workspace(),job.material(),job.version(),job.id(),ordinal++,c.locator(),c.method(),c.content());
        db.update("UPDATE knowledge_runs SET status=?,parser_version=?,warnings=?,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=?",result.status(),result.parserVersion(),String.join(",",result.warnings()),job.id());
        fileTables.finish(job,result);
        audit.record(job.actor(),job.tenant(),"KNOWLEDGE_FINISH",job.id(),Set.of("READY","PARTIAL").contains(result.status())?"SUCCESS":"FAILURE");
    }
    @Transactional
    public void abandon(Job job,boolean permission) {
        db.update("UPDATE knowledge_runs SET status=?,warnings=?,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=? AND status='RUNNING' AND lease_token=?",permission?"CANCELLED":"FAILED",permission?"ACCESS_CHANGED":"PARSER_UNAVAILABLE_OR_LIMIT",job.id(),job.token());
    }
}
