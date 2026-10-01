package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.math.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Immutable delivery identity is the successful task, never its mutable conversation projection. */
@Service
public class BriefingCardService {
    public record Move(UUID id,UUID cardId,UUID anchorId,String direction,int appliedRevision,int currentRevision) {}
    private final JdbcTemplate db;
    private final ConversationService conversations;
    private final BriefingContentService content;
    private final IdentityService identities;
    public BriefingCardService(JdbcTemplate db,ConversationService conversations,BriefingContentService content,IdentityService identities){this.db=db;this.conversations=conversations;this.content=content;this.identities=identities;}
    private UUID require(UUID actor,UUID tenant,UUID task){
        var rows=db.queryForList("SELECT conversation_id,workspace_id,attempt FROM conversation_tasks WHERE tenant_id=? AND id=? AND status='SUCCEEDED'",tenant,task);
        if(rows.isEmpty())throw new IdentityException(404,"BRIEFING_NOT_FOUND");
        var r=rows.getFirst();conversations.historical(actor,tenant,(UUID)r.get("conversation_id"),task);
        if(content.find(task,(Integer)r.get("attempt"))==null)throw new IdentityException(404,"BRIEFING_NOT_FOUND");
        return (UUID)r.get("workspace_id");
    }
    private BriefingService.Preference value(UUID task){
        var rows=db.query("SELECT * FROM briefing_card_preferences WHERE task_id=?",(r,n)->new BriefingService.Preference(r.getInt("revision"),r.getBoolean("pinned"),r.getBoolean("hidden"),r.getString("size")),task);
        return rows.isEmpty()?new BriefingService.Preference(0,false,false,"STANDARD"):rows.getFirst();
    }
    @Transactional public BriefingService.Preference get(UUID actor,UUID tenant,UUID task){require(actor,tenant,task);return value(task);}
    private void lock(UUID actor,UUID tenant){
        db.update("INSERT INTO briefing_layouts(tenant_id,owner_id) VALUES(?,?) ON CONFLICT DO NOTHING",tenant,actor);
        db.queryForList("SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=? FOR UPDATE",tenant,actor);
    }
    private int revision(UUID actor,UUID tenant){return db.queryForObject("SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=?",Integer.class,tenant,actor);}
    @Transactional public BriefingService.Preference update(UUID actor,UUID tenant,UUID task,UUID request,int expected,boolean pinned,boolean hidden,String size){
        if(request==null||expected<0||size==null||!Set.of("STANDARD","WIDE").contains(size))throw IdentityException.invalid();
        UUID space=require(actor,tenant,task);lock(actor,tenant);
        String hash=IdentityService.hash(tenant+":"+task+":"+expected+":"+pinned+":"+hidden+":"+size);
        if(identities.priorRequest(actor,request,"BRIEFING_CARD_PREFERENCE",hash)!=null)return value(task);
        if(value(task).revision()!=expected)throw new IdentityException(409,"BRIEFING_REVISION_CONFLICT");
        db.update("INSERT INTO briefing_card_preferences(task_id,tenant_id,workspace_id,owner_id,pinned,hidden,size) VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET pinned=excluded.pinned,hidden=excluded.hidden,size=excluded.size,revision=briefing_card_preferences.revision+1,updated_at=now()",task,tenant,space,actor,pinned,hidden,size);
        identities.remember(actor,request,"BRIEFING_CARD_PREFERENCE",hash,task);return value(task);
    }
    private BigDecimal position(UUID task){
        var p=value(task);if(!p.pinned()||p.hidden())throw new IdentityException(404,"BRIEFING_NOT_FOUND");
        return db.queryForObject("SELECT focus_position FROM briefing_card_preferences WHERE task_id=?",BigDecimal.class,task);
    }
    @Transactional public Move move(UUID actor,UUID tenant,UUID key,int expected,UUID task,UUID anchor,String direction){
        if(key==null||task==null||anchor==null||task.equals(anchor)||expected<0||direction==null||!Set.of("BEFORE","AFTER").contains(direction))throw IdentityException.invalid();
        require(actor,tenant,task);require(actor,tenant,anchor);lock(actor,tenant);position(task);BigDecimal at=position(anchor);
        String hash=IdentityService.hash(tenant+":"+expected+":"+task+":"+anchor+":"+direction);
        UUID prior=identities.priorRequest(actor,key,"BRIEFING_CARD_MOVE",hash);if(prior!=null)return receipt(actor,tenant,prior);
        if(revision(actor,tenant)!=expected)throw new IdentityException(409,"BRIEFING_LAYOUT_CHANGED");
        boolean before=direction.equals("BEFORE");
        BigDecimal next=next(actor,tenant,task,at,before);
        if(next==null){
            db.update("WITH ranks AS(SELECT task_id,row_number() OVER(ORDER BY focus_position,task_id)*1024 AS p FROM briefing_card_preferences WHERE tenant_id=? AND owner_id=? AND focus_position IS NOT NULL) UPDATE briefing_card_preferences b SET focus_position=r.p FROM ranks r WHERE b.task_id=r.task_id",tenant,actor);
            next=next(actor,tenant,task,position(anchor),before);
        }
        if(next==null)throw new IdentityException(409,"BRIEFING_LAYOUT_CHANGED");
        db.update("UPDATE briefing_card_preferences SET focus_position=? WHERE task_id=?",next,task);
        UUID id=UUID.randomUUID();db.update("INSERT INTO briefing_card_moves VALUES(?,?,?,?,?,?,?)",id,tenant,actor,task,anchor,direction,revision(actor,tenant));
        identities.remember(actor,key,"BRIEFING_CARD_MOVE",hash,id);return receipt(actor,tenant,id);
    }
    private BigDecimal next(UUID actor,UUID tenant,UUID task,BigDecimal at,boolean before){
        var adjacent=db.queryForObject("SELECT "+(before?"max":"min")+"(focus_position) FROM briefing_card_preferences WHERE tenant_id=? AND owner_id=? AND task_id<>? AND focus_position"+(before?"<":">")+"?",BigDecimal.class,tenant,actor,task,at);
        if(adjacent==null)return at.add(BigDecimal.valueOf(before?-1024:1024));
        var next=at.add(adjacent).divide(BigDecimal.valueOf(2),12,RoundingMode.HALF_UP);
        return next.compareTo(at)==0||next.compareTo(adjacent)==0?null:next;
    }
    private Move receipt(UUID actor,UUID tenant,UUID id){return db.queryForObject("SELECT * FROM briefing_card_moves WHERE tenant_id=? AND owner_id=? AND id=?",(r,n)->new Move(id,r.getObject("task_id",UUID.class),r.getObject("anchor_id",UUID.class),r.getString("direction"),r.getInt("applied_revision"),revision(actor,tenant)),tenant,actor,id);}
}
