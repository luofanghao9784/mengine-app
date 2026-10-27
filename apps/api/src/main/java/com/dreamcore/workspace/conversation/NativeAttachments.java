package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.material.ObjectStore;
@Service
public class NativeAttachments {
 private final NativeConversationService sessions;private final JdbcTemplate db;
 public NativeAttachments(NativeConversationService s,JdbcTemplate d){sessions=s;db=d;}
 public record Attachment(UUID id,String filename,String mediaType,String sha256,int bytes){}
 private List<Attachment> rows(UUID id){return db.query("SELECT id,filename,media_type,sha256,octet_length(content) bytes FROM native_conversation_attachments WHERE session_id=? ORDER BY created_at",(r,n)->new Attachment(r.getObject("id",UUID.class),r.getString("filename"),r.getString("media_type"),r.getString("sha256"),r.getInt("bytes")),id);}
 @Transactional public Attachment upload(UUID actor,UUID tenant,UUID id,UUID key,MultipartFile file){
  sessions.require(actor,tenant,id,true);if(key==null||file==null||file.isEmpty())throw IdentityException.invalid();if(file.getSize()>20*1024*1024)throw new IdentityException(413,"NATIVE_ATTACHMENT_TOO_LARGE");
  String name=MaterialService.name(file.getOriginalFilename());byte[] bytes;try{bytes=file.getBytes();}catch(Exception e){throw IdentityException.invalid();}if(bytes.length>20*1024*1024)throw new IdentityException(413,"NATIVE_ATTACHMENT_TOO_LARGE");
  String type=imageType(bytes),hash=ObjectStore.sha256(bytes);var prior=db.queryForList("SELECT id,filename,sha256 FROM native_conversation_attachments WHERE session_id=? AND request_id=?",id,key);
  if(!prior.isEmpty()){var p=prior.getFirst();if(!hash.equals(p.get("sha256"))||!name.equals(p.get("filename")))throw new IdentityException(409,"NATIVE_REQUEST_CONFLICT");return new Attachment((UUID)p.get("id"),name,type,hash,bytes.length);}
  if(db.queryForObject("SELECT coalesce(sum(octet_length(content)),0) FROM native_conversation_attachments WHERE session_id=?",Long.class,id)+bytes.length>100*1024*1024)throw new IdentityException(413,"NATIVE_ATTACHMENT_LIMIT");
  UUID aid=UUID.randomUUID();db.update("INSERT INTO native_conversation_attachments(id,session_id,request_id,filename,media_type,sha256,content) VALUES (?,?,?,?,?,?,?)",aid,id,key,name,type,hash,bytes);return new Attachment(aid,name,type,hash,bytes.length);
 }
 private String imageType(byte[] b){if(b.length>=8&&b[0]==(byte)137&&b[1]==80&&b[2]==78&&b[3]==71&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10)return "image/png";if(b.length>=3&&b[0]==(byte)255&&b[1]==(byte)216&&b[2]==(byte)255)return "image/jpeg";if(b.length>=6&&(new String(b,0,6,java.nio.charset.StandardCharsets.US_ASCII).equals("GIF87a")||new String(b,0,6,java.nio.charset.StandardCharsets.US_ASCII).equals("GIF89a")))return "image/gif";if(b.length>=12&&new String(b,0,4,java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF")&&new String(b,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WEBP"))return "image/webp";return "application/octet-stream";}
 @Transactional public List<Attachment> list(UUID actor,UUID tenant,UUID id){sessions.require(actor,tenant,id,false);return rows(id);}
 @Transactional public void validate(UUID actor,UUID tenant,UUID id,List<UUID> ids){sessions.require(actor,tenant,id,true);if(ids.size()>10||new HashSet<>(ids).size()!=ids.size())throw IdentityException.invalid();var allowed=rows(id).stream().map(Attachment::id).toList();if(!allowed.containsAll(ids))throw new IdentityException(404,"NATIVE_ATTACHMENT_NOT_FOUND");}
 @Transactional public MaterialService.Download download(UUID actor,UUID tenant,UUID id,UUID attachment){sessions.require(actor,tenant,id,false);var rows=db.query("SELECT filename,content FROM native_conversation_attachments WHERE session_id=? AND id=?",(r,n)->new MaterialService.Download(r.getString(1),r.getBytes(2)),id,attachment);if(rows.isEmpty())throw new IdentityException(404,"NATIVE_ATTACHMENT_NOT_FOUND");return rows.getFirst();}
 @Transactional public Object runtime(UUID id,String token,UUID attachment){var s=sessions.check(id,token);var f=download(s.ownerId(),s.tenantId(),id,attachment);return Map.of("id",attachment,"filename",f.filename(),"mediaType",imageType(f.bytes()),"sha256",ObjectStore.sha256(f.bytes()),"contentBase64",Base64.getEncoder().encodeToString(f.bytes()));}
}
