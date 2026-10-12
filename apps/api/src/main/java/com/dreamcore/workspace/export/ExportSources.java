package com.dreamcore.workspace.export;

import com.dreamcore.workspace.document.DocumentService;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

/** Uses existing source readers; shared publications expose only their independent target metadata. */
@Service
public class ExportSources {
 public record Selection(UUID objectId,int version,String format) {}
 public record Choice(Selection selection,UUID versionId,String title,long sizeBytes,Instant createdAt) {}
 public record Options(List<Choice> items,boolean hasMore,boolean canExport,List<Integer> retentionDays,int maxItems,long maxBytes) {}
 public record File(Choice choice,byte[] bytes,List<UUID> sourceVersions) {}
 private final JdbcTemplate db;private final DocumentService documents;private final MaterialService materials;private final MaterialAccess access;private final GovernanceAccess governance;private final IdentityService identities;
 public ExportSources(JdbcTemplate db,DocumentService documents,MaterialService materials,MaterialAccess access,GovernanceAccess governance,IdentityService identities){this.db=db;this.documents=documents;this.materials=materials;this.access=access;this.governance=governance;this.identities=identities;}
 public void validScope(String scope){if(!Set.of("PRIVATE","ENTERPRISE").contains(scope==null?"":scope))throw IdentityException.invalid();}
 public void valid(Selection s){if(s==null||s.objectId()==null||s.version()<1||s.format()==null||!Set.of("docx","pdf").contains(s.format()))throw IdentityException.invalid();}
 public boolean scope(UUID actor,UUID tenant,UUID workspace,String scope,boolean requireExport){
  validScope(scope);var space=access.require(actor,tenant,workspace,false);
  if(!space.kind().equals(scope.equals("PRIVATE")?"PERSONAL":"SHARED"))throw new IdentityException(404,"EXPORT_SCOPE_UNAVAILABLE");
  boolean allowed=governance.allows(actor,tenant,GovernanceAccess.Capability.BULK_EXPORT,null)||(scope.equals("ENTERPRISE")&&governance.allows(actor,tenant,GovernanceAccess.Capability.BULK_EXPORT,workspace));
  if(requireExport&&!allowed)throw new IdentityException(403,"BULK_EXPORT_REQUIRED");return allowed;
 }
 private List<UUID> materialSources(UUID task){
  return db.queryForList("SELECT version_id FROM library_task_versions(?)",UUID.class,task);
 }
 private Choice choice(UUID actor,UUID tenant,UUID workspace,String scope,Selection s){
  valid(s);
  if(scope.equals("ENTERPRISE"))access.requireObject(actor,tenant,workspace,"MATERIAL",s.objectId(),false);
  if(scope.equals("PRIVATE")){var d=documents.detail(actor,tenant,s.objectId(),s.version());if(!d.document().workspaceId().equals(workspace))throw new IdentityException(404,"EXPORT_ITEM_UNAVAILABLE");return new Choice(s,null,d.version().title(),-1,d.version().createdAt());}
  var rows=db.query("SELECT p.material_version_id,p.filename,v.size_bytes,p.published_at FROM document_publications p JOIN material_versions v ON v.id=p.material_version_id WHERE p.tenant_id=? AND p.workspace_id=? AND p.material_id=? AND p.material_version=? AND p.format=?",(r,n)->new Choice(s,r.getObject(1,UUID.class),r.getString(2),r.getLong(3),r.getTimestamp(4).toInstant()),tenant,workspace,s.objectId(),s.version(),s.format());
  if(rows.isEmpty())throw new IdentityException(404,"EXPORT_ITEM_UNAVAILABLE");var c=rows.getFirst();access.requireVersionActive(tenant,workspace,c.versionId());return c;
 }
 @Transactional(propagation=Propagation.REQUIRES_NEW) public Choice inspect(UUID actor,UUID tenant,UUID workspace,String scope,Selection selection,boolean export){scope(actor,tenant,workspace,scope,export);var c=choice(actor,tenant,workspace,scope,selection);if(scope.equals("PRIVATE"))for(UUID version:materialSources(documents.detail(actor,tenant,selection.objectId(),selection.version()).document().taskId()))access.requireVersion(actor,tenant,version,export);return c;}
 private void checkVersion(UUID actor,UUID tenant,UUID version){access.requireVersion(actor,tenant,version,true);}

 @Transactional(propagation=Propagation.REQUIRES_NEW) public void verifySources(UUID actor,UUID tenant,List<UUID> versions){identities.member(actor,tenant,false);for(UUID version:versions)checkVersion(actor,tenant,version);}
 @Transactional(propagation=Propagation.REQUIRES_NEW) public File export(UUID actor,UUID tenant,UUID workspace,String scope,Selection selection){
  scope(actor,tenant,workspace,scope,true);var c=choice(actor,tenant,workspace,scope,selection);byte[] bytes;List<UUID> versions;
  if(scope.equals("PRIVATE")){versions=materialSources(documents.detail(actor,tenant,selection.objectId(),selection.version()).document().taskId());for(UUID v:versions)checkVersion(actor,tenant,v);bytes=documents.export(actor,tenant,selection.objectId(),selection.version(),selection.format()).bytes();}
  else{versions=List.of(c.versionId());if(c.sizeBytes()>2097152)throw new IdentityException(413,"EXPORT_ITEM_TOO_LARGE");bytes=materials.download(actor,tenant,workspace,selection.objectId(),c.versionId()).bytes();}
  if(bytes.length<1||bytes.length>2097152)throw new IdentityException(413,"EXPORT_ITEM_TOO_LARGE");return new File(new Choice(selection,c.versionId(),c.title(),bytes.length,c.createdAt()),bytes,versions);
 }
 @Transactional public List<Selection> selectionPage(UUID actor,UUID tenant,UUID workspace,String scope,UUID object,String format,int offset,int limit){
  scope(actor,tenant,workspace,scope,false);if(offset<0||offset>100000||limit<1||limit>30||!Set.of("docx","pdf").contains(format))throw IdentityException.invalid();
  if(scope.equals("PRIVATE")){
   if(object!=null)return db.query("SELECT v.document_id,v.number FROM private_document_versions v JOIN private_documents d ON d.id=v.document_id WHERE d.tenant_id=? AND d.workspace_id=? AND d.owner_id=? AND d.id=? AND object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id)) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id) ORDER BY v.number DESC LIMIT ? OFFSET ?",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2),format),tenant,workspace,actor,object,limit+1,offset);
   return db.query("SELECT id,revision FROM private_documents WHERE tenant_id=? AND workspace_id=? AND owner_id=? AND object_is_active('DOCUMENT',id) AND (source_artifact_id IS NULL OR object_is_active('ARTIFACT',source_artifact_id)) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=source_task_id) ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2),format),tenant,workspace,actor,limit+1,offset);
  }
  if(object!=null){access.requireObject(actor,tenant,workspace,"MATERIAL",object,false);return db.query("SELECT p.material_id,p.material_version,p.format FROM document_publications p JOIN active_materials m ON m.id=p.material_id WHERE p.tenant_id=? AND p.workspace_id=? AND p.material_id=? ORDER BY p.material_version DESC LIMIT ? OFFSET ?",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2),r.getString(3)),tenant,workspace,object,limit+1,offset);}
  return db.query("SELECT material_id,material_version,format FROM (SELECT DISTINCT ON(p.material_id) p.material_id,p.material_version,p.format,p.published_at FROM document_publications p JOIN active_materials m ON m.id=p.material_id WHERE p.tenant_id=? AND p.workspace_id=? AND (library_mask(?::uuid,p.tenant_id,'MATERIAL',p.material_id)&1)=1 ORDER BY p.material_id,p.material_version DESC) latest ORDER BY published_at DESC,material_id LIMIT ? OFFSET ?",(r,n)->new Selection(r.getObject(1,UUID.class),r.getInt(2),r.getString(3)),tenant,workspace,actor,limit+1,offset);
 }
}
