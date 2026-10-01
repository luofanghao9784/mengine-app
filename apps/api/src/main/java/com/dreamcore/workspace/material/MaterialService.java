package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.io.IOException;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MaterialService {
    public record Crumb(UUID id, String name) {}
    public record Entry(UUID id, UUID tenantId, UUID workspaceId, String workspaceName, UUID folderId, String kind,
                        String name, int version, Long sizeBytes, Instant updatedAt, List<String> path, boolean canMaintain) {}
    public record Page(UUID tenantId, UUID workspaceId, UUID folderId, List<Crumb> trail, boolean canMaintain,
                       long maxUploadBytes, List<Entry> items, boolean hasMore) {}
    public record Version(UUID id, int number, String filename, long sizeBytes, String sha256, UUID createdBy, Instant createdAt, String origin) {}
    public record Detail(Entry document, List<Version> versions, boolean hasMore, boolean inLibrary) {}
    /** Top-level entry is the accepted version when known; currentVersion is read at replay time. */
    public record UploadReceipt(UUID id, UUID tenantId, UUID workspaceId, String workspaceName, UUID folderId, String kind,
                                String name, int version, Long sizeBytes, Instant updatedAt, List<String> path, boolean canMaintain,
                                String receiptStatus, Version acceptedVersion, int currentVersion) {
        UploadReceipt(Entry current,Version accepted) {
            this(current.id(),current.tenantId(),current.workspaceId(),current.workspaceName(),current.folderId(),current.kind(),
                current.name(),accepted==null?current.version():accepted.number(),accepted==null?current.sizeBytes():accepted.sizeBytes(),
                accepted==null?current.updatedAt():accepted.createdAt(),current.path(),current.canMaintain(),
                accepted==null?"HISTORICAL_UNKNOWN":"EXACT",accepted,current.version());
        }
        public Entry entry(){return new Entry(id,tenantId,workspaceId,workspaceName,folderId,kind,name,version,sizeBytes,updatedAt,path,canMaintain);}
    }
    public record Download(String filename, byte[] bytes) {}
    private final JdbcTemplate db; private final IdentityService identities; private final IdentityAudit audit;
    private final com.dreamcore.workspace.knowledge.KnowledgeService knowledge;
    private final MaterialAccess access; private final ObjectStore store; private final int maxBytes;
    public MaterialService(JdbcTemplate db, IdentityService identities, IdentityAudit audit, MaterialAccess access, ObjectStore store, com.dreamcore.workspace.knowledge.KnowledgeService knowledge,
                            @Value("${dreamcore.material.max-bytes:20971520}") int maxBytes) {
        this.db=db; this.identities=identities; this.audit=audit; this.access=access; this.store=store; this.maxBytes=maxBytes;this.knowledge=knowledge;
    }
    public static String name(String value) {
        if(value==null) throw IdentityException.invalid();
        String cleaned=Normalizer.normalize(value.strip(),Normalizer.Form.NFC);
        if(cleaned.isBlank() || cleaned.length()>180 || cleaned.equals(".") || cleaned.equals("..") || cleaned.codePoints().anyMatch(c -> c==47 || c==92 || Character.isISOControl(c) || Character.getType(c)==Character.FORMAT)) throw new IdentityException(400,"MATERIAL_NAME_INVALID");
        return cleaned;
    }
    private void paging(int offset,int limit) { if(offset<0 || offset>100000 || limit<1 || limit>100) throw IdentityException.invalid(); }
    private IdentityException missing() { return new IdentityException(404,"MATERIAL_NOT_FOUND"); }
    private List<Crumb> trail(UUID tenant,UUID workspace,UUID folder) {
        var result=new ArrayList<Crumb>(); var seen=new HashSet<UUID>();
        while(folder!=null) {
            if(!seen.add(folder) || result.size()>=32) throw new IdentityException(409,"MATERIAL_FOLDER_DEPTH");
            var rows=db.queryForList("SELECT id,name,parent_id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,workspace,folder);
            if(rows.isEmpty()) throw missing(); var row=rows.getFirst();
            result.add(new Crumb((UUID)row.get("id"),(String)row.get("name"))); folder=(UUID)row.get("parent_id");
        }
        Collections.reverse(result); return result;
    }
    private RowMapper<Entry> entry(UUID tenant,UUID actor) {
        return (r,n)-> {
            UUID workspace=r.getObject("workspace_id",UUID.class),folder=r.getObject("parent_id",UUID.class);
            var path=new ArrayList<String>(); path.add(r.getString("workspace_name"));
            trail(tenant,workspace,folder).forEach(c->path.add(c.name())); path.add(r.getString("name"));
            return new Entry(r.getObject("id",UUID.class),tenant,workspace,r.getString("workspace_name"),folder,r.getString("kind"),
                r.getString("name"),r.getInt("version"),(Long)r.getObject("size_bytes"),r.getTimestamp("updated_at").toInstant(),path,r.getBoolean("can_maintain"));
        };
    }
    private static final String ENTRIES="""
        WITH entries AS (
          SELECT f.id,f.tenant_id,f.workspace_id,f.parent_id,'FOLDER' AS kind,f.name,0 AS version,NULL::bigint AS size_bytes,f.created_at AS updated_at
          FROM active_material_folders f
          UNION ALL
          SELECT m.id,m.tenant_id,m.workspace_id,m.folder_id,'DOCUMENT',m.name,m.current_version,v.size_bytes,m.updated_at
          FROM active_materials m JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.material_id=m.id AND v.number=m.current_version
          UNION ALL
          SELECT d.id,d.tenant_id,d.workspace_id,NULL::uuid,'DRAFT',v.title,d.revision,octet_length(v.body)::bigint,d.updated_at
          FROM private_documents d JOIN private_document_versions v ON v.document_id=d.id AND v.number=d.revision
          JOIN workspaces source ON source.id=d.source_workspace_id AND source.tenant_id=d.tenant_id
          WHERE object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id))
            AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id)
            AND ((source.kind='PERSONAL' AND source.owner_id=d.owner_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.source_workspace_id AND g.account_id=d.owner_id))
        )
        SELECT e.*,w.name AS workspace_name,((w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=w.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED')) AS can_maintain
        FROM entries e JOIN workspaces w ON w.tenant_id=e.tenant_id AND w.id=e.workspace_id
        LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
        WHERE e.tenant_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL)) AND departure_content_readable(coalesce(g.account_id,w.owner_id),w.tenant_id,w.id)
        """;
    @Transactional
    public Page list(UUID actor,UUID tenant,UUID workspace,UUID folder,String q,int offset,int limit) {
        paging(offset,limit); if(q.length()>180 || (workspace==null && folder!=null)) throw IdentityException.invalid();
        identities.member(actor,tenant,false);
        var space=workspace==null ? null : access.require(actor,tenant,workspace,false);
        var crumbs=workspace==null ? List.<Crumb>of() : trail(tenant,workspace,folder);
        String query=q.strip();
        // Restrict search to the selected directory subtree; match filename or the latest parsed body.
        String within = folder==null ? "true" : "e.parent_id IN (WITH RECURSIVE subtree AS (SELECT id FROM active_material_folders WHERE id=? AND tenant_id=? AND workspace_id=? UNION ALL SELECT f.id FROM active_material_folders f JOIN subtree p ON f.parent_id=p.id WHERE f.tenant_id=? AND f.workspace_id=?) SELECT id FROM subtree)";
        var args=new ArrayList<Object>(List.of(actor,tenant,actor));
        String filter=workspace==null?"w.kind='SHARED' AND e.kind='DOCUMENT'":"e.workspace_id=?";
        if(workspace!=null)args.add(workspace);
        filter+=" AND (e.kind IN ('FOLDER','DRAFT') OR EXISTS(SELECT 1 FROM materials m WHERE m.id=e.id AND m.in_library))";
        if(query.isEmpty()) { if(workspace!=null){filter+=" AND e.parent_id IS NOT DISTINCT FROM ?::uuid";args.add(folder);} }
        else {
            filter+=" AND ("+within+")";
            if(folder!=null)args.addAll(List.of(folder,tenant,workspace,tenant,workspace));
            filter+=" AND (strpos(lower(e.name),lower(?))>0 OR EXISTS(SELECT 1 FROM material_versions v JOIN knowledge_runs r ON r.version_id=v.id JOIN knowledge_chunks c ON c.run_id=r.id WHERE v.material_id=e.id AND v.number=e.version AND r.status IN ('READY','PARTIAL') AND r.generation=(SELECT max(k.generation) FROM knowledge_runs k WHERE k.version_id=v.id) AND strpos(lower(c.content),lower(?))>0) OR EXISTS(SELECT 1 FROM private_document_versions d WHERE d.document_id=e.id AND d.number=e.version AND strpos(lower(d.body),lower(?))>0))";
            args.add(query);args.add(query);args.add(query);
        }
        args.add(limit+1);args.add(offset);
        var items=db.query(ENTRIES+" AND "+filter+" ORDER BY CASE WHEN e.kind='FOLDER' THEN 0 ELSE 1 END,e.updated_at DESC,e.id LIMIT ? OFFSET ?",entry(tenant,actor),args.toArray());
        return new Page(tenant,workspace,folder,crumbs,space!=null&&space.canMaintain(),maxBytes,items.stream().limit(limit).toList(),items.size()>limit);
    }
    private Entry document(UUID actor,UUID tenant,UUID workspace,UUID id) {
        var rows=db.query(ENTRIES+" AND e.workspace_id=? AND e.id=? AND e.kind='DOCUMENT'",entry(tenant,actor),actor,tenant,actor,workspace,id);
        if(rows.isEmpty()) throw missing(); return rows.getFirst();
    }
    @Transactional
    public Detail detail(UUID actor,UUID tenant,UUID workspace,UUID id,int offset,int limit) {
        paging(offset,limit); access.require(actor,tenant,workspace,false); Entry doc=document(actor,tenant,workspace,id);
        var versions=db.query("SELECT v.*,CASE WHEN p.id IS NULL THEN 'UPLOAD' ELSE 'DOCUMENT_PUBLICATION' END AS origin FROM material_versions v LEFT JOIN document_publications p ON p.material_version_id=v.id WHERE v.tenant_id=? AND v.workspace_id=? AND v.material_id=? ORDER BY v.number DESC LIMIT ? OFFSET ?",
            (r,n)->new Version(r.getObject("id",UUID.class),r.getInt("number"),r.getString("filename"),r.getLong("size_bytes"),r.getString("sha256"),
                r.getObject("created_by",UUID.class),r.getTimestamp("created_at").toInstant(),r.getString("origin")),tenant,workspace,id,limit+1,offset);
        return new Detail(doc,versions.stream().limit(limit).toList(),versions.size()>limit,db.queryForObject("SELECT in_library FROM materials WHERE id=?",Boolean.class,id));
    }
    @Transactional public Version version(UUID actor,UUID tenant,UUID workspace,UUID material,UUID version){
        access.require(actor,tenant,workspace,false);document(actor,tenant,workspace,material);access.requireVersionActive(tenant,workspace,version);
        var rows=db.query("SELECT v.*,CASE WHEN p.id IS NULL THEN 'UPLOAD' ELSE 'DOCUMENT_PUBLICATION' END origin FROM material_versions v LEFT JOIN document_publications p ON p.material_version_id=v.id WHERE v.id=? AND v.tenant_id=? AND v.workspace_id=? AND v.material_id=?",(r,n)->new Version(r.getObject("id",UUID.class),r.getInt("number"),r.getString("filename"),r.getLong("size_bytes"),r.getString("sha256"),r.getObject("created_by",UUID.class),r.getTimestamp("created_at").toInstant(),r.getString("origin")),version,tenant,workspace,material);
        if(rows.isEmpty())throw missing();return rows.getFirst();
    }
    @Transactional
    public Crumb createFolder(UUID actor,UUID tenant,UUID workspace,UUID parent,String suppliedName,UUID key) {
        String name=name(suppliedName),fingerprint=IdentityService.hash(tenant+"\n"+workspace+"\n"+parent+"\n"+name);
        UUID prior=identities.priorRequest(actor,key,"MATERIAL_FOLDER_CREATE",fingerprint);
        access.require(actor,tenant,workspace,true);
        if(prior!=null) return trail(tenant,workspace,prior).getLast();
        if(trail(tenant,workspace,parent).size()>=32) throw new IdentityException(409,"MATERIAL_FOLDER_DEPTH");
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO material_folders(id,tenant_id,workspace_id,parent_id,name,created_by) VALUES (?,?,?,?,?,?)",id,tenant,workspace,parent,name,actor);
        identities.remember(actor,key,"MATERIAL_FOLDER_CREATE",fingerprint,id); audit.record(actor,tenant,"MATERIAL_FOLDER_CREATE",id,"SUCCESS");
        return new Crumb(id,name);
    }
    @Transactional
    public Entry upload(UUID actor,UUID tenant,UUID workspace,UUID folder,UUID material,Integer expectedVersion,UUID key,MultipartFile file) {
        return uploadReceipt(actor,tenant,workspace,folder,material,expectedVersion,key,file).entry();
    }
    @Transactional
    public UploadReceipt uploadReceipt(UUID actor,UUID tenant,UUID workspace,UUID folder,UUID material,Integer expectedVersion,UUID key,MultipartFile file) {
        // Preliminary authorization before reading file bytes; recheck under lock after the request lock.
        access.check(actor,tenant,workspace,true,false);
        String filename=name(file.getOriginalFilename());
        if(file.getSize()>maxBytes) throw new IdentityException(413,"MATERIAL_TOO_LARGE");
        byte[] bytes;
        try(var input=file.getInputStream()) {
            bytes=input.readNBytes(maxBytes+1);
        } catch(IOException error) { throw new IdentityException(503,"MATERIAL_UPLOAD_FAILED"); }
        if(bytes.length>maxBytes) throw new IdentityException(413,"MATERIAL_TOO_LARGE");
        if((material==null && expectedVersion!=null) || (material!=null && (expectedVersion==null || expectedVersion<1 || folder!=null))) throw IdentityException.invalid();
        String hash=ObjectStore.sha256(bytes),fingerprint=IdentityService.hash(tenant+"\n"+workspace+"\n"+folder+"\n"+material+"\n"+expectedVersion+"\n"+filename+"\n"+hash);
        UUID prior=identities.priorRequest(actor,key,"MATERIAL_UPLOAD",fingerprint);
        access.require(actor,tenant,workspace,true);
        if(prior!=null) return uploadReceipt(actor,tenant,workspace,prior,key);
        Entry result=storeGenerated(actor,tenant,workspace,folder,material,expectedVersion,filename,bytes);
        identities.remember(actor,key,"MATERIAL_UPLOAD",fingerprint,result.id());
        db.update("INSERT INTO material_upload_receipts(actor_id,request_id,tenant_id,workspace_id,material_id,version_id) SELECT ?,?,tenant_id,workspace_id,material_id,id FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND number=?",actor,key,tenant,workspace,result.id(),result.version());
        return uploadReceipt(actor,tenant,workspace,result.id(),key);
    }
    private UploadReceipt uploadReceipt(UUID actor,UUID tenant,UUID workspace,UUID material,UUID key) {
        Entry current=document(actor,tenant,workspace,material);
        var accepted=db.query("SELECT v.* FROM material_upload_receipts r JOIN material_versions v ON v.id=r.version_id AND v.tenant_id=r.tenant_id AND v.workspace_id=r.workspace_id AND v.material_id=r.material_id WHERE r.actor_id=? AND r.request_id=? AND r.tenant_id=? AND r.workspace_id=? AND r.material_id=?",
            (r,n)->new Version(r.getObject("id",UUID.class),r.getInt("number"),r.getString("filename"),r.getLong("size_bytes"),r.getString("sha256"),r.getObject("created_by",UUID.class),r.getTimestamp("created_at").toInstant(),"UPLOAD"),actor,key,tenant,workspace,material);
        return new UploadReceipt(current,accepted.isEmpty()?null:accepted.getFirst());
    }
    /** Internal platform operation; callers own their request idempotency. Not exposed as an HTTP upload bypass. */
    @Transactional public Entry storeGenerated(UUID actor,UUID tenant,UUID workspace,UUID folder,UUID material,Integer expectedVersion,String suppliedFilename,byte[] bytes){
        access.require(actor,tenant,workspace,true);String filename=name(suppliedFilename);
        if(bytes.length>maxBytes)throw new IdentityException(413,"MATERIAL_TOO_LARGE");
        if((material==null && expectedVersion!=null) || (material!=null && (expectedVersion==null || expectedVersion<1 || folder!=null)))throw IdentityException.invalid();
        String hash=ObjectStore.sha256(bytes);
        int number=1;
        if(material!=null) {
            db.queryForList("SELECT id FROM materials WHERE tenant_id=? AND workspace_id=? AND id=? FOR UPDATE",tenant,workspace,material);
            Entry current=document(actor,tenant,workspace,material);
            if(current.version()!=expectedVersion) throw new IdentityException(409,"MATERIAL_VERSION_CONFLICT");
            number=Math.addExact(current.version(),1);
        } else trail(tenant,workspace,folder);
        UUID id=material==null?UUID.randomUUID():material,object=store.put(bytes);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) { if(status!=STATUS_COMMITTED) store.discard(object); }
        });
        if(material==null) db.update("INSERT INTO materials(id,tenant_id,workspace_id,folder_id,name,created_by) VALUES (?,?,?,?,?,?)",id,tenant,workspace,folder,filename,actor);
        else db.update("UPDATE materials SET current_version=?,updated_at=now() WHERE tenant_id=? AND workspace_id=? AND id=?",number,tenant,workspace,id);
        UUID versionId=UUID.randomUUID();
        db.update("INSERT INTO material_versions(id,tenant_id,workspace_id,material_id,number,filename,size_bytes,sha256,object_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
            versionId,tenant,workspace,id,number,filename,bytes.length,hash,object,actor);
        knowledge.onUpload(actor,tenant,workspace,id,versionId);
        audit.record(actor,tenant,material==null?"MATERIAL_UPLOAD":"MATERIAL_VERSION",id,"SUCCESS");
        return document(actor,tenant,workspace,id);
    }
    @Transactional
    public Download download(UUID actor,UUID tenant,UUID workspace,UUID material,UUID version) {
        access.require(actor,tenant,workspace,false);
        access.requireMaterialActive(tenant,workspace,material);
        var rows=db.queryForList("SELECT filename,object_id,size_bytes,sha256 FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND id=?",tenant,workspace,material,version);
        if(rows.isEmpty()) throw missing(); var row=rows.getFirst();
        byte[] bytes=store.read((UUID)row.get("object_id"),(Long)row.get("size_bytes"),(String)row.get("sha256"));
        audit.record(actor,tenant,"MATERIAL_DOWNLOAD",version,"SUCCESS");
        return new Download((String)row.get("filename"),bytes);
    }
}
