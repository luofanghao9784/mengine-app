package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BriefingLayoutService {
 public record Layout(UUID tenantId,int revision) {}
 public record Move(UUID id,UUID conversationId,UUID anchorId,String direction,int appliedRevision,int currentRevision) {}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final DepartureAccess departure;private final IdentityAudit audit;
 public BriefingLayoutService(JdbcTemplate db,IdentityService identities,MaterialAccess access,DepartureAccess departure,IdentityAudit audit){this.db=db;this.identities=identities;this.access=access;this.departure=departure;this.audit=audit;}
 private void authority(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);}
 private int revision(UUID actor,UUID tenant){return db.queryForObject("SELECT coalesce((SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=?),0)",Integer.class,tenant,actor);}
 @Transactional public Layout get(UUID actor,UUID tenant){authority(actor,tenant);return new Layout(tenant,revision(actor,tenant));}
 private BigDecimal card(UUID actor,UUID tenant,UUID id){
  var rows=db.queryForList("SELECT c.workspace_id,p.focus_position FROM conversations c JOIN briefing_preferences p ON p.conversation_id=c.id AND p.owner_id=c.owner_id WHERE c.id=? AND c.tenant_id=? AND c.owner_id=? AND p.pinned AND NOT p.hidden AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN readable_source_tasks rt ON rt.id=t.id WHERE t.conversation_id=c.id AND t.mode='AGENT' AND t.status='SUCCEEDED' AND t.reply IS NOT NULL)",id,tenant,actor);
  if(rows.isEmpty())throw new IdentityException(404,"BRIEFING_NOT_FOUND");
  access.require(actor,tenant,(UUID)rows.getFirst().get("workspace_id"),false);
  return (BigDecimal)rows.getFirst().get("focus_position");
 }
 private BigDecimal position(UUID actor,UUID tenant,UUID moving,BigDecimal anchor,boolean before){
  var adjacent=db.queryForObject("SELECT "+(before?"max":"min")+"(focus_position) FROM briefing_preferences WHERE tenant_id=? AND owner_id=? AND conversation_id<>? AND focus_position"+(before?"<":">")+"?",BigDecimal.class,tenant,actor,moving,anchor);
  if(adjacent==null)return anchor.add(BigDecimal.valueOf(before?-1024:1024));
  BigDecimal middle=anchor.add(adjacent).divide(BigDecimal.valueOf(2),12,RoundingMode.HALF_UP);
  return middle.compareTo(anchor)==0||middle.compareTo(adjacent)==0?null:middle;
 }
 @Transactional public Move move(UUID actor,UUID tenant,UUID key,int expected,UUID conversation,UUID anchor,String direction){
  if(key==null||conversation==null||anchor==null||conversation.equals(anchor)||expected<0||direction==null||!Set.of("BEFORE","AFTER").contains(direction))throw IdentityException.invalid();
  authority(actor,tenant);
  db.update("INSERT INTO briefing_layouts(tenant_id,owner_id) VALUES (?,?) ON CONFLICT DO NOTHING",tenant,actor);
  db.queryForList("SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=? FOR UPDATE",tenant,actor);
  card(actor,tenant,conversation);BigDecimal at=card(actor,tenant,anchor);
  String hash=IdentityService.hash(tenant+"\n"+expected+"\n"+conversation+"\n"+anchor+"\n"+direction);
  UUID prior=identities.priorRequest(actor,key,"BRIEFING_LAYOUT_MOVE",hash);
  if(prior!=null)return receipt(actor,tenant,prior);
  if(revision(actor,tenant)!=expected)throw new IdentityException(409,"BRIEFING_LAYOUT_CHANGED");
  boolean before=direction.equals("BEFORE");BigDecimal next=position(actor,tenant,conversation,at,before);
  if(next==null){
   db.update("WITH ranks AS(SELECT conversation_id,row_number() OVER(ORDER BY focus_position,conversation_id)*1024 AS p FROM briefing_preferences WHERE tenant_id=? AND owner_id=? AND focus_position IS NOT NULL) UPDATE briefing_preferences b SET focus_position=r.p FROM ranks r WHERE b.conversation_id=r.conversation_id",tenant,actor);
   at=card(actor,tenant,anchor);next=position(actor,tenant,conversation,at,before);
  }
  if(next==null)throw new IdentityException(409,"BRIEFING_LAYOUT_CHANGED");
  db.update("UPDATE briefing_preferences SET focus_position=? WHERE conversation_id=? AND tenant_id=? AND owner_id=?",next,conversation,tenant,actor);
  UUID id=UUID.randomUUID();int applied=revision(actor,tenant);
  db.update("INSERT INTO briefing_layout_moves(id,tenant_id,owner_id,conversation_id,anchor_id,direction,applied_revision) VALUES (?,?,?,?,?,?,?)",id,tenant,actor,conversation,anchor,direction,applied);
  identities.remember(actor,key,"BRIEFING_LAYOUT_MOVE",hash,id);audit.record(actor,tenant,"BRIEFING_LAYOUT_MOVE",conversation,"SUCCESS");
  return receipt(actor,tenant,id);
 }
 private Move receipt(UUID actor,UUID tenant,UUID id){return db.queryForObject("SELECT * FROM briefing_layout_moves WHERE id=? AND tenant_id=? AND owner_id=?",(r,n)->new Move(id,r.getObject("conversation_id",UUID.class),r.getObject("anchor_id",UUID.class),r.getString("direction"),r.getInt("applied_revision"),revision(actor,tenant)),id,tenant,actor);}
}
