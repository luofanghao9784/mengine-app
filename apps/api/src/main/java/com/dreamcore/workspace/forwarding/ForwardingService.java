package com.dreamcore.workspace.forwarding;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ForwardingService {
 public record Source(UUID publicationId,UUID workspaceId,String workspaceName,UUID materialId,UUID materialVersionId,int materialVersion,String filename,String format,String sha256,Instant publishedAt) {}
 public record Person(UUID id,String name) {}
 public record People(Source source,List<Person> items,boolean hasMore) {}
 public record Recipient(UUID receiptId,UUID accountId,String name,String state,Instant openedAt,boolean currentlyAccessible) {}
 public record Batch(UUID id,UUID publicationId,UUID materialVersionId,UUID requestId,Instant acceptedAt,String note,Source source,List<Recipient> recipients) {}
 public record Delivery(UUID id,UUID batchId,UUID senderId,String senderName,Instant acceptedAt,Instant openedAt,String state,String note,Source source) {}
 public record Inbox(List<Delivery> items,boolean hasMore) {}
 public record History(List<Batch> items,boolean hasMore) {}
 public record Send(UUID requestId,UUID publicationId,UUID materialVersionId,List<UUID> recipients,String note) {}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess materials;private final DepartureAccess departure;private final IdentityAudit audit;
 private final JsonMapper json=new JsonMapper();
 public ForwardingService(JdbcTemplate db,IdentityService identities,MaterialAccess materials,DepartureAccess departure,IdentityAudit audit){this.db=db;this.identities=identities;this.materials=materials;this.departure=departure;this.audit=audit;}
 private IdentityException missing(){return new IdentityException(404,"FORWARDING_NOT_AVAILABLE");}
 private void page(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>30)throw IdentityException.invalid();}
 private Instant time(Map<String,Object> r,String k){return r.get(k)==null?null:((Timestamp)r.get(k)).toInstant();}
 private void member(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);}
 private boolean readable(UUID actor,UUID tenant,UUID publication,UUID version){return Boolean.TRUE.equals(db.queryForObject("SELECT forwarding_publication_readable(?,?,?,?)",Boolean.class,actor,tenant,publication,version));}
 private Source source(UUID actor,UUID tenant,UUID publication,UUID version){
  member(actor,tenant);
  var rows=db.queryForList("SELECT p.*,w.name AS workspace_name FROM document_publications p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=? AND p.tenant_id=? AND p.material_version_id=?",publication,tenant,version);if(rows.isEmpty())throw missing();var r=rows.getFirst();UUID space=(UUID)r.get("workspace_id");
  if(!materials.require(actor,tenant,space,false).kind().equals("SHARED"))throw missing();materials.requireVersionActive(tenant,space,version);if(!readable(actor,tenant,publication,version))throw missing();
  return new Source(publication,space,(String)r.get("workspace_name"),(UUID)r.get("material_id"),version,(Integer)r.get("material_version"),(String)r.get("filename"),(String)r.get("format"),(String)r.get("sha256"),time(r,"published_at"));
 }
 @Transactional public People recipients(UUID actor,UUID tenant,UUID publication,UUID version,String query,int offset,int limit){
  page(offset,limit);if(query==null)query="";if(query.length()>100)throw IdentityException.invalid();var s=source(actor,tenant,publication,version);
  var people=db.query("SELECT a.id,a.display_name FROM accounts a JOIN workspace_members w ON w.account_id=a.id AND w.tenant_id=? AND w.workspace_id=? WHERE a.id<>? AND forwarding_publication_readable(a.id,?,?,?) AND (?='' OR position(lower(?) in lower(a.display_name))>0) ORDER BY a.display_name,a.id LIMIT ? OFFSET ?",(r,n)->new Person(r.getObject(1,UUID.class),r.getString(2)),tenant,s.workspaceId(),actor,tenant,publication,version,query,query,limit+1,offset);
  return new People(s,people.stream().limit(limit).toList(),people.size()>limit);
 }
 @Transactional public Batch send(UUID actor,UUID tenant,Send input){
  if(input==null||input.requestId()==null||input.publicationId()==null||input.materialVersionId()==null||input.recipients()==null||input.recipients().isEmpty()||input.recipients().size()>20||input.recipients().stream().anyMatch(Objects::isNull)||new HashSet<>(input.recipients()).size()!=input.recipients().size()||input.recipients().contains(actor)||input.note()==null||input.note().length()>500||input.note().codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=9))throw IdentityException.invalid();
  source(actor,tenant,input.publicationId(),input.materialVersionId());
  var receivers=input.recipients().stream().sorted().toList();String hash=IdentityService.hash(json.writeValueAsString(List.of(tenant,input.publicationId(),input.materialVersionId(),receivers,input.note())));
  UUID prior=identities.priorRequest(actor,input.requestId(),"PUBLICATION_FORWARD",hash);
  if(prior!=null)return batch(actor,tenant,prior);
  for(UUID receiver:receivers){if(!readable(receiver,tenant,input.publicationId(),input.materialVersionId()))throw missing();source(receiver,tenant,input.publicationId(),input.materialVersionId());}
  UUID id=UUID.randomUUID();db.update("INSERT INTO publication_forward_batches(id,tenant_id,sender_id,publication_id,material_version_id,request_id,request_hash,note) VALUES (?,?,?,?,?,?,?,?)",id,tenant,actor,input.publicationId(),input.materialVersionId(),input.requestId(),hash,input.note());
  for(UUID receiver:receivers)db.update("INSERT INTO publication_forward_receipts(id,batch_id,recipient_id) VALUES (?,?,?)",UUID.randomUUID(),id,receiver);
  identities.remember(actor,input.requestId(),"PUBLICATION_FORWARD",hash,id);audit.record(actor,tenant,"PUBLICATION_FORWARD",id,"SUCCESS");return batch(actor,tenant,id);
 }
 @Transactional public Batch batch(UUID actor,UUID tenant,UUID id){
  member(actor,tenant);var rows=db.queryForList("SELECT * FROM publication_forward_batches WHERE id=? AND tenant_id=? AND sender_id=? AND NOT scrubbed",id,tenant,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();UUID publication=(UUID)r.get("publication_id"),version=(UUID)r.get("material_version_id");var s=source(actor,tenant,publication,version);
  var recipients=db.query("SELECT r.*,a.display_name,forwarding_publication_readable(r.recipient_id,?,?,?) AS accessible FROM publication_forward_receipts r JOIN accounts a ON a.id=r.recipient_id WHERE batch_id=? ORDER BY r.recipient_id",(rs,n)->new Recipient(rs.getObject("id",UUID.class),rs.getObject("recipient_id",UUID.class),rs.getBoolean("accessible")?rs.getString("display_name"):"当前不可访问的接收人",rs.getTimestamp("opened_at")==null?"ACCEPTED":"OPENED",rs.getTimestamp("opened_at")==null?null:rs.getTimestamp("opened_at").toInstant(),rs.getBoolean("accessible")),tenant,publication,version,id);
  return new Batch(id,publication,version,(UUID)r.get("request_id"),time(r,"accepted_at"),(String)r.get("note"),s,recipients);
 }
 @Transactional public History history(UUID actor,UUID tenant,UUID publication,UUID version,int offset,int limit){
  page(offset,limit);source(actor,tenant,publication,version);var ids=db.queryForList("SELECT id FROM publication_forward_batches WHERE tenant_id=? AND sender_id=? AND publication_id=? AND material_version_id=? AND NOT scrubbed ORDER BY accepted_at DESC,id LIMIT ? OFFSET ?",UUID.class,tenant,actor,publication,version,limit+1,offset);return new History(ids.stream().limit(limit).map(id->batch(actor,tenant,id)).toList(),ids.size()>limit);
 }
 private static final String VISIBLE="""
  FROM publication_forward_receipts r JOIN publication_forward_batches b ON b.id=r.batch_id
  WHERE b.tenant_id=? AND r.recipient_id=? AND NOT b.scrubbed
  AND forwarding_publication_readable(r.recipient_id,b.tenant_id,b.publication_id,b.material_version_id)
  AND forwarding_publication_readable(b.sender_id,b.tenant_id,b.publication_id,b.material_version_id)
  """;
 @Transactional public Inbox inbox(UUID actor,UUID tenant,int offset,int limit){
  page(offset,limit);member(actor,tenant);var ids=db.queryForList("SELECT r.id "+VISIBLE+" ORDER BY b.accepted_at DESC,r.id LIMIT ? OFFSET ?",UUID.class,tenant,actor,limit+1,offset);return new Inbox(ids.stream().limit(limit).map(id->delivery(actor,tenant,id)).toList(),ids.size()>limit);
 }
 private Delivery delivery(UUID actor,UUID tenant,UUID id){
  var rows=db.queryForList("SELECT r.id,r.opened_at,b.id AS batch_id,b.sender_id,b.accepted_at,b.note,b.publication_id,b.material_version_id "+VISIBLE+" AND r.id=?",tenant,actor,id);if(rows.isEmpty())throw missing();var r=rows.getFirst();var s=source(actor,tenant,(UUID)r.get("publication_id"),(UUID)r.get("material_version_id"));source((UUID)r.get("sender_id"),tenant,s.publicationId(),s.materialVersionId());
  String sender=db.queryForObject("SELECT display_name FROM accounts WHERE id=?",String.class,r.get("sender_id"));return new Delivery(id,(UUID)r.get("batch_id"),(UUID)r.get("sender_id"),sender,time(r,"accepted_at"),time(r,"opened_at"),r.get("opened_at")==null?"ACCEPTED":"OPENED",(String)r.get("note"),s);
 }
 @Transactional public Delivery open(UUID actor,UUID tenant,UUID receipt,UUID key){
  if(key==null)throw IdentityException.invalid();member(actor,tenant);var before=delivery(actor,tenant,receipt);String hash=IdentityService.hash(tenant+":"+receipt);UUID prior=identities.priorRequest(actor,key,"PUBLICATION_FORWARD_OPEN",hash);if(prior!=null)return delivery(actor,tenant,prior);
  db.update("UPDATE publication_forward_receipts SET opened_at=coalesce(opened_at,now()) WHERE id=? AND recipient_id=?",receipt,actor);identities.remember(actor,key,"PUBLICATION_FORWARD_OPEN",hash,receipt);audit.record(actor,tenant,"PUBLICATION_FORWARD_OPEN",receipt,"SUCCESS");return delivery(actor,tenant,receipt);
 }
}
