package com.dreamcore.workspace.document;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Explicit, immutable publication. Shared readers use material permissions, never the private document reader. */
@Service
public class DocumentPublicationService {
    public record Publication(UUID id,UUID tenantId,UUID documentId,int documentVersion,UUID workspaceId,UUID folderId,UUID materialId,UUID materialVersionId,int materialVersion,String filename,String format,String sha256,Instant publishedAt) {}
    public record Page(UUID tenantId,UUID documentId,List<Publication> items,boolean hasMore) {}
    private final JdbcTemplate db;private final DocumentService documents;private final MaterialService materials;private final MaterialAccess access;private final IdentityService identities;private final IdentityAudit audit;
    public DocumentPublicationService(JdbcTemplate db,DocumentService documents,MaterialService materials,MaterialAccess access,IdentityService identities,IdentityAudit audit){this.db=db;this.documents=documents;this.materials=materials;this.access=access;this.identities=identities;this.audit=audit;}
    private final RowMapper<Publication> mapper=(r,n)->new Publication(r.getObject("id",UUID.class),r.getObject("tenant_id",UUID.class),r.getObject("document_id",UUID.class),r.getInt("document_version"),r.getObject("workspace_id",UUID.class),r.getObject("destination_folder_id",UUID.class),r.getObject("material_id",UUID.class),r.getObject("material_version_id",UUID.class),r.getInt("material_version"),r.getString("filename"),r.getString("format"),r.getString("sha256"),r.getTimestamp("published_at").toInstant());
    private Publication receipt(UUID actor,UUID tenant,UUID id){
        var rows=db.query("SELECT * FROM document_publications WHERE tenant_id=? AND actor_id=? AND id=?",mapper,tenant,actor,id);
        if(rows.isEmpty())throw new IdentityException(404,"DOCUMENT_NOT_FOUND");var value=rows.getFirst();access.requireObject(actor,tenant,value.workspaceId(),"MATERIAL",value.materialId(),false);return value;
    }
    @Transactional public Page list(UUID actor,UUID tenant,UUID document,int offset,int limit){
        if(offset<0 || offset>10000 || limit<1 || limit>30)throw IdentityException.invalid();
        documents.detail(actor,tenant,document,null);
        var values=db.query("""
            SELECT p.* FROM document_publications p JOIN workspace_members g ON g.tenant_id=p.tenant_id AND g.workspace_id=p.workspace_id AND g.account_id=p.actor_id
            WHERE p.tenant_id=? AND p.actor_id=? AND p.document_id=? AND (library_mask(p.actor_id,p.tenant_id,'MATERIAL',p.material_id)&1)=1 ORDER BY p.published_at DESC,p.id LIMIT ? OFFSET ?
            """,mapper,tenant,actor,document,limit+1,offset);
        return new Page(tenant,document,values.stream().limit(limit).toList(),values.size()>limit);
    }
    @Transactional public Publication publish(UUID actor,UUID tenant,UUID document,int version,UUID key,UUID workspace,UUID folder,UUID material,Integer expectedVersion,String format,boolean acknowledged){
        if(!acknowledged || version<1 || workspace==null || format==null || !Set.of("docx","pdf").contains(format) || (material==null && expectedVersion!=null) || (material!=null && (folder!=null || expectedVersion==null || expectedVersion<1)))throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(new Object[]{tenant,document,version,workspace,folder,material,expectedVersion,format}));
        UUID prior=identities.priorRequest(actor,key,"DOCUMENT_PUBLISH",fingerprint);
        var destination=access.requireObject(actor,tenant,workspace,material!=null?"MATERIAL":folder!=null?"FOLDER":"WORKSPACE",material!=null?material:folder!=null?folder:workspace,true);
        if(!destination.kind().equals("SHARED"))throw new IdentityException(400,"DOCUMENT_PUBLISH_TARGET_INVALID");
        if(prior!=null){documents.detail(actor,tenant,document,version);return receipt(actor,tenant,prior);}
        // export acquires the private document lock. Different request keys for the same publication serialize here.
        var exported=documents.publicationContent(actor,tenant,document,version,format);
        var source=documents.detail(actor,tenant,document,version);
        if(Boolean.TRUE.equals(db.queryForObject("SELECT library_permissions_enabled(?)",Boolean.class,tenant))){
            String targetKind=material!=null?"MATERIAL":folder!=null?"FOLDER":"WORKSPACE";UUID target=material!=null?material:folder!=null?folder:workspace;
            var audience=db.queryForList("SELECT account_id FROM tenant_memberships WHERE tenant_id=? AND status='ACTIVE' AND (library_mask(account_id,tenant_id,?,?)&1)=1",UUID.class,tenant,targetKind,target);
            for(UUID recipient:audience)access.requireTaskSources(recipient,tenant,source.document().taskId(),false);
        }
        var existing=db.queryForList("SELECT id FROM document_publications WHERE tenant_id=? AND actor_id=? AND document_id=? AND document_version=? AND workspace_id=? AND folder_id IS NOT DISTINCT FROM ? AND update_material_id IS NOT DISTINCT FROM ? AND format=?",UUID.class,tenant,actor,document,version,workspace,folder,material,format);
        UUID id;
        if(!existing.isEmpty())id=existing.getFirst();
        else {
            String filename=MaterialService.name(source.version().title().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}\\p{Cf}]","_").strip()+"."+format);
            var stored=materials.storeGenerated(actor,tenant,workspace,folder,material,expectedVersion,filename,exported.bytes());
            var saved=db.queryForObject("SELECT id FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND number=?",UUID.class,tenant,workspace,stored.id(),stored.version());
            id=UUID.randomUUID();
            db.update("INSERT INTO document_publications(id,tenant_id,actor_id,document_id,document_version,workspace_id,folder_id,destination_folder_id,update_material_id,material_id,material_version_id,material_version,format,filename,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,tenant,actor,document,version,workspace,folder,stored.folderId(),material,stored.id(),saved,stored.version(),format,filename,exported.sha256());
            audit.record(actor,tenant,"DOCUMENT_PUBLISH",stored.id(),"SUCCESS");
        }
        identities.remember(actor,key,"DOCUMENT_PUBLISH",fingerprint,id);return receipt(actor,tenant,id);
    }
}
