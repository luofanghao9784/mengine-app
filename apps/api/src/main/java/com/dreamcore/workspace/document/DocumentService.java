package com.dreamcore.workspace.document;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DocumentService {
    public record Document(UUID id,UUID tenantId,UUID workspaceId,UUID sourceWorkspaceId,UUID conversationId,UUID taskId,UUID artifactId,int revision,String title,Instant updatedAt) {}
    public record Version(int number,String title,String body,Instant createdAt) {}
    public record Detail(Document document,Version version) {}
    public record Page(UUID tenantId,List<Document> items,boolean hasMore) {}
    public record Export(String filename,String sha256,byte[] bytes,String contentType) {}
    private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;
    private final ConversationService conversations;private final AgentTaskService agents;private final IdentityAudit audit;private final DocumentRenderer renderer;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public DocumentService(JdbcTemplate db,IdentityService identities,MaterialAccess access,ConversationService conversations,AgentTaskService agents,IdentityAudit audit,DocumentRenderer renderer,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.db=db;this.identities=identities;this.access=access;this.conversations=conversations;this.agents=agents;this.audit=audit;this.renderer=renderer;}
    private final RowMapper<Document> mapper=(r,n)->new Document(r.getObject("id",UUID.class),r.getObject("tenant_id",UUID.class),r.getObject("workspace_id",UUID.class),r.getObject("source_workspace_id",UUID.class),r.getObject("source_conversation_id",UUID.class),r.getObject("source_task_id",UUID.class),r.getObject("source_artifact_id",UUID.class),r.getInt("revision"),r.getString("title"),r.getTimestamp("updated_at").toInstant());
    private static final String SELECT="SELECT d.*,v.title FROM private_documents d JOIN private_document_versions v ON v.document_id=d.id AND v.number=d.revision ";
    private IdentityException missing(){return new IdentityException(404,"DOCUMENT_NOT_FOUND");}
    private Document require(UUID actor,UUID tenant,UUID id,boolean lock){
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        // Lock the document row first, then read its current version with a fresh READ COMMITTED snapshot.
        // A join in the locking statement can lose the row after a concurrent revision change.
        if(lock && db.queryForList("SELECT id FROM private_documents WHERE tenant_id=? AND owner_id=? AND id=? FOR NO KEY UPDATE",UUID.class,tenant,actor,id).isEmpty())throw missing();
        var rows=db.query(SELECT+"WHERE d.tenant_id=? AND d.owner_id=? AND d.id=? AND object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id))",mapper,tenant,actor,id);
        if(rows.isEmpty())throw missing();var doc=rows.getFirst();
        var personal=access.require(actor,tenant,doc.workspaceId(),false);if(!personal.kind().equals("PERSONAL"))throw missing();
        if(db.queryForList("SELECT id FROM readable_source_tasks WHERE id=?",doc.taskId()).isEmpty())throw missing();
        // Source dependency survives every edit and cached export. The existing task reader checks all fixed sources/originals.
        conversations.historical(actor,tenant,doc.conversationId(),doc.taskId());
        return doc;
    }
    public static void validate(String title,String body){
        if(title==null || title.isBlank() || title.length()>160 || title.codePoints().anyMatch(Character::isISOControl) || body==null || body.isBlank() || body.length()>32768 || invalidXml(title) || invalidXml(body))throw IdentityException.invalid();
    }
    private static boolean invalidXml(String s){return s.codePoints().anyMatch(c->(c<32 && c!=9 && c!=10 && c!=13) || (c>=0xd800 && c<=0xdfff) || c==0xfffe || c==0xffff);}
    @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit){
        if(offset<0 || offset>10000 || limit<1 || limit>30)throw IdentityException.invalid();identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var rows=db.query(SELECT+"""
            JOIN workspaces own ON own.id=d.workspace_id AND own.tenant_id=d.tenant_id AND own.kind='PERSONAL' AND own.owner_id=d.owner_id
            JOIN workspaces source ON source.id=d.source_workspace_id AND source.tenant_id=d.tenant_id
            LEFT JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.source_workspace_id AND g.account_id=d.owner_id
            WHERE object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id)) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id) AND d.tenant_id=? AND d.owner_id=? AND ((source.kind='PERSONAL' AND source.owner_id=d.owner_id) OR (source.kind='SHARED' AND g.account_id IS NOT NULL))
            ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?
            """,mapper,tenant,actor,limit+1,offset);
        var visible=rows.stream().limit(limit).toList();for(var doc:visible)require(actor,tenant,doc.id(),false);
        return new Page(tenant,visible,rows.size()>limit);
    }
    @Transactional public Detail detail(UUID actor,UUID tenant,UUID id,Integer number){
        var doc=require(actor,tenant,id,false);int n=number==null?doc.revision():number;if(n<1)throw IdentityException.invalid();
        var versions=db.query("SELECT * FROM private_document_versions WHERE tenant_id=? AND document_id=? AND number=?",(r,i)->new Version(r.getInt("number"),r.getString("title"),r.getString("body"),r.getTimestamp("created_at").toInstant()),tenant,id,n);
        if(versions.isEmpty())throw missing();return new Detail(doc,versions.getFirst());
    }
    @Transactional public Detail create(UUID actor,UUID tenant,UUID conversation,UUID task,UUID artifact,UUID key){
        String fingerprint=IdentityService.hash(tenant+"\n"+conversation+"\n"+task+"\n"+artifact);
        UUID prior=identities.priorRequest(actor,key,"DOCUMENT_CREATE",fingerprint);
        if(prior!=null)return detail(actor,tenant,prior,null);
        var source=conversations.historical(actor,tenant,conversation,task);var result=source.tasks().getFirst();
        String title=source.conversation().title(),body=result.reply();
        if(artifact!=null){
            var file=agents.download(actor,tenant,conversation,task,artifact);
            if(!file.filename().toLowerCase(Locale.ROOT).matches(".*\\.(txt|md)$"))throw new IdentityException(400,"DOCUMENT_SOURCE_UNSUPPORTED");
            try{body=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(file.bytes())).toString();}catch(CharacterCodingException e){throw new IdentityException(400,"DOCUMENT_SOURCE_UNSUPPORTED");}
            title=file.filename().replaceFirst("\\.[^.]+$","");
        }
        validate(title,body);
        var existing=db.queryForList("SELECT id FROM private_documents WHERE tenant_id=? AND owner_id=? AND source_task_id=? AND source_artifact_id IS NOT DISTINCT FROM ?",UUID.class,tenant,actor,task,artifact);
        UUID id;
        if(!existing.isEmpty())id=existing.getFirst();
        else {
            var spaces=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL'",UUID.class,tenant,actor);if(spaces.isEmpty())throw missing();UUID space=spaces.getFirst();access.require(actor,tenant,space,true);
            id=UUID.randomUUID();db.update("INSERT INTO private_documents(id,tenant_id,owner_id,workspace_id,source_workspace_id,source_conversation_id,source_task_id,source_artifact_id,revision) VALUES (?,?,?,?,?,?,?,?,1)",id,tenant,actor,space,source.conversation().workspaceId(),conversation,task,artifact);
            db.update("INSERT INTO private_document_versions(tenant_id,document_id,number,title,body) VALUES (?,?,1,?,?)",tenant,id,title,body);
            audit.record(actor,tenant,"DOCUMENT_CREATE",id,"SUCCESS");
        }
        identities.remember(actor,key,"DOCUMENT_CREATE",fingerprint,id);return detail(actor,tenant,id,null);
    }
    @Transactional public Detail save(UUID actor,UUID tenant,UUID id,UUID key,int revision,String title,String body){
        validate(title,body);if(revision<1)throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(new Object[]{tenant,id,revision,title,body}));
        UUID prior=identities.priorRequest(actor,key,"DOCUMENT_SAVE",fingerprint);
        var doc=require(actor,tenant,id,true);if(prior!=null)return detail(actor,tenant,id,db.queryForObject("SELECT version FROM private_document_writes WHERE actor_id=? AND request_id=?",Integer.class,actor,key));
        if(doc.revision()!=revision)throw new IdentityException(409,"DOCUMENT_REVISION_CONFLICT");
        var current=detail(actor,tenant,id,null).version();
        if(!current.title().equals(title) || !current.body().equals(body)){
            db.update("INSERT INTO private_document_versions(tenant_id,document_id,number,title,body) VALUES (?,?,?,?,?)",tenant,id,revision+1,title,body);
            db.update("UPDATE private_documents SET revision=revision+1,updated_at=now() WHERE id=?",id);audit.record(actor,tenant,"DOCUMENT_SAVE",id,"SUCCESS");
        }
        var saved=detail(actor,tenant,id,null);
        identities.remember(actor,key,"DOCUMENT_SAVE",fingerprint,id);
        db.update("INSERT INTO private_document_writes(actor_id,request_id,tenant_id,document_id,version) VALUES (?,?,?,?,?)",actor,key,tenant,id,saved.version().number());return saved;
    }
    @Transactional public Export export(UUID actor,UUID tenant,UUID id,int version,String format){return render(actor,tenant,id,version,format,true);}
    @Transactional public Export publicationContent(UUID actor,UUID tenant,UUID id,int version,String format){return render(actor,tenant,id,version,format,false);}
    private Export render(UUID actor,UUID tenant,UUID id,int version,String format,boolean download){
        if(!Set.of("docx","pdf").contains(format))throw IdentityException.invalid();
        var source=require(actor,tenant,id,true);access.requireTaskSources(actor,tenant,source.taskId(),download);var value=detail(actor,tenant,id,version).version();
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM private_document_exports x JOIN object_lifecycle l ON l.kind='EXPORT_CACHE' AND l.parent_id=x.document_id AND (l.details->>'version')::integer=x.version AND l.details->>'format'=x.format AND l.original_anchor=x.created_at WHERE x.tenant_id=? AND x.document_id=? AND x.version=? AND x.format=? AND NOT object_is_active('EXPORT_CACHE',l.object_id))",Boolean.class,tenant,id,version,format)))throw new IdentityException(410,"DOCUMENT_EXPORT_EXPIRED");
        var cached=db.query("SELECT sha256,content FROM private_document_exports WHERE tenant_id=? AND document_id=? AND version=? AND format=?",(r,n)->new Export("document-v"+version+"."+format,r.getString(1),r.getBytes(2),DocumentRenderer.contentType(format)),tenant,id,version,format);
        if(!cached.isEmpty())return cached.getFirst();
        byte[] bytes=renderer.render(value.title(),value.body(),format);String hash;
        try{hash=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}catch(Exception e){throw new IllegalStateException();}
        db.update("INSERT INTO private_document_exports(tenant_id,document_id,version,format,renderer_version,sha256,content) VALUES (?,?,?,?,?,?,?)",tenant,id,version,format,DocumentRenderer.VERSION,hash,bytes);
        audit.record(actor,tenant,"DOCUMENT_EXPORT",id,"SUCCESS");return new Export("document-v"+version+"."+format,hash,bytes,DocumentRenderer.contentType(format));
    }
}
