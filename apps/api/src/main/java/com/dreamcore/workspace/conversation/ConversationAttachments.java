package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ConversationAttachments {
 public record Receipt(ConversationService.Conversation conversation, MaterialService.UploadReceipt file) {}
 private final JdbcTemplate db; private final ConversationService conversations; private final MaterialService materials; private final IdentityService identities;
 public ConversationAttachments(JdbcTemplate db,ConversationService conversations,MaterialService materials,IdentityService identities){this.db=db;this.conversations=conversations;this.materials=materials;this.identities=identities;}
 @Transactional public Receipt upload(UUID actor,UUID tenant,UUID conversation,UUID draftRequest,UUID request,MultipartFile file){
  return upload(actor,tenant,conversation,draftRequest,request,file,null);
 }
 @Transactional public Receipt upload(UUID actor,UUID tenant,UUID conversation,UUID draftRequest,UUID request,MultipartFile file,UUID workspace){
  identities.member(actor,tenant,false);
  UUID personal=db.queryForObject("SELECT id FROM workspaces WHERE tenant_id=? AND kind='PERSONAL' AND owner_id=?",UUID.class,tenant,actor);
  var c=conversation==null?conversations.draft(actor,tenant,workspace==null?personal:workspace,Objects.requireNonNull(draftRequest)):conversations.require(actor,tenant,conversation,true);
  if(workspace!=null&&!workspace.equals(c.workspaceId()))throw new IdentityException(409,"CONVERSATION_WORKSPACE_CHANGED");
  String fingerprint=IdentityService.hash(tenant+"\n"+c.id()+"\n"+request);
  UUID prior=identities.priorRequest(actor,request,"ATTACHMENT_SCOPE",fingerprint);
  // The stable scope request is independent of MaterialService's exact upload receipt.
  UUID uploadKey=UUID.nameUUIDFromBytes(("attachment-upload:"+request).getBytes(java.nio.charset.StandardCharsets.UTF_8));
  var result=materials.uploadReceipt(actor,tenant,personal,null,null,null,uploadKey,file);
  var rows=db.queryForList("SELECT attachment_conversation_id FROM materials WHERE id=? FOR UPDATE",result.id());
  Object bound=rows.getFirst().get("attachment_conversation_id");
  if(bound!=null&&!bound.equals(c.id()))throw new IdentityException(409,"ATTACHMENT_SCOPE_CHANGED");
  if(bound==null)db.update("UPDATE materials SET in_library=false,attachment_conversation_id=? WHERE id=?",c.id(),result.id());
  if(prior==null)identities.remember(actor,request,"ATTACHMENT_SCOPE",fingerprint,result.id());
  return new Receipt(c,result);
 }
 @Transactional public ConversationService.Conversation draft(UUID actor,UUID tenant,UUID request){
  identities.member(actor,tenant,false);var ids=db.queryForList("SELECT target_id FROM identity_requests WHERE actor_id=? AND request_id=? AND operation='CONVERSATION_DRAFT'",UUID.class,actor,request);return ids.isEmpty()?null:conversations.require(actor,tenant,ids.getFirst(),false);
 }
 @Transactional public List<MaterialService.Detail> list(UUID actor,UUID tenant,UUID conversation){
  conversations.require(actor,tenant,conversation,false);
  return db.queryForList("SELECT id,workspace_id FROM active_materials WHERE tenant_id=? AND attachment_conversation_id=? ORDER BY created_at,id",tenant,conversation).stream().map(r->materials.detail(actor,tenant,(UUID)r.get("workspace_id"),(UUID)r.get("id"),0,1)).toList();
 }
 @Transactional public MaterialService.Detail save(UUID actor,UUID tenant,UUID conversation,UUID material,UUID request){
  conversations.require(actor,tenant,conversation,true);
  var rows=db.queryForList("SELECT workspace_id FROM active_materials WHERE tenant_id=? AND attachment_conversation_id=? AND id=? FOR UPDATE",tenant,conversation,material);
  if(rows.isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
  UUID space=(UUID)rows.getFirst().get("workspace_id");
  var detail=materials.detail(actor,tenant,space,material,0,1);
  String hash=IdentityService.hash(tenant+"\n"+conversation+"\n"+material);UUID prior=identities.priorRequest(actor,request,"ATTACHMENT_SAVE",hash);
  db.update("UPDATE materials SET in_library=true WHERE id=?",material);if(prior==null)identities.remember(actor,request,"ATTACHMENT_SAVE",hash,material);
  return materials.detail(actor,tenant,space,material,0,1);
 }
}
