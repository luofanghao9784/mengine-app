package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Account-scoped geometry only. This record never grants access to a referenced card. */
@Service
public class PersonalFollowBoard {
    public record Board(UUID tenantId, String board, int revision, JsonNode preference) {}
    public record Receipt(int appliedRevision, Board current) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final DepartureAccess departure;
    private final JsonMapper json=new JsonMapper();
    public PersonalFollowBoard(JdbcTemplate db, IdentityService identities, DepartureAccess departure) {
        this.db=db; this.identities=identities; this.departure=departure;
    }
    private void authority(UUID actor, UUID tenant, String board) {
        if (!Set.of("PRIVATE", "PUBLICATIONS").contains(board)) throw IdentityException.invalid();
        identities.member(actor,tenant,false);
        departure.requirePrivateRead(actor,tenant);
    }
    private JsonNode parse(String value) {
        if (value == null) return null;
        try { return json.readTree(value); } catch (Exception e) { throw new IllegalStateException("Invalid board geometry",e); }
    }
    @Transactional
    public Board get(UUID actor, UUID tenant, String board) {
        authority(actor,tenant,board);
        var rows=db.query("SELECT revision,preference::text FROM personal_follow_boards WHERE tenant_id=? AND owner_id=? AND board=?",
            (r,n)->new Board(tenant,board,r.getInt(1),parse(r.getString(2))),tenant,actor,board);
        return rows.isEmpty()?new Board(tenant,board,0,null):rows.getFirst();
    }
    private boolean integer(JsonNode n, int min, int max) { return n!=null && n.isIntegralNumber() && n.canConvertToInt() && n.intValue()>=min && n.intValue()<=max; }
    private boolean id(String id) { return id!=null && id.matches("[a-zA-Z0-9:_-]{1,160}"); }
    private void validate(JsonNode p) {
        if(p==null || p.isNull()) return;
        if(!p.isObject() || p.size()!=2 || !p.has("sizes") || !p.has("layout")) throw IdentityException.invalid();
        var sizes=p.get("sizes");var layout=p.get("layout");
        if(!sizes.isObject() || sizes.size()>2000 || !layout.isObject() || !integer(layout.get("columns"),1,12)) throw IdentityException.invalid();
        sizes.properties().forEach(e->{ if(!id(e.getKey()) || !Set.of("1×1","1×2","2×1","2×2").contains(e.getValue().asString())) throw IdentityException.invalid(); });
        var order=layout.path("order");var positions=layout.path("positions");var manual=layout.path("manual");
        if(!order.isArray() || order.size()>2000 || !positions.isArray() || positions.size()!=order.size() || !manual.isArray() || manual.size()>2000) throw IdentityException.invalid();
        Set<String> ids=new HashSet<>();
        for(var n:order) if(!n.isTextual() || !id(n.asString()) || !ids.add(n.asString())) throw IdentityException.invalid();
        Set<String> placed=new HashSet<>();
        for(var n:positions) {
            String key=n.path("id").asString();
            if(!n.isObject() || n.size()!=4 || !ids.contains(key) || !placed.add(key) || !integer(n.get("row"),0,10000) || !integer(n.get("col"),0,11) || n.path("col").intValue()>=layout.path("columns").intValue() || !Set.of("1×1","1×2","2×1","2×2").contains(n.path("size").asString())) throw IdentityException.invalid();
        }
        for(var n:manual) if(!n.isTextual() || !ids.contains(n.asString())) throw IdentityException.invalid();
        if(layout.size()!=4) throw IdentityException.invalid();
    }
    @Transactional
    public Receipt save(UUID actor, UUID tenant, String board, UUID requestId, int expected, JsonNode preference) {
        authority(actor,tenant,board);validate(preference);
        if(requestId==null || expected<0) throw IdentityException.invalid();
        db.update("INSERT INTO personal_follow_boards(tenant_id,owner_id,board) VALUES(?,?,?) ON CONFLICT DO NOTHING",tenant,actor,board);
        db.queryForList("SELECT revision FROM personal_follow_boards WHERE tenant_id=? AND owner_id=? AND board=? FOR UPDATE",tenant,actor,board);
        String encoded=preference==null || preference.isNull()?null:preference.toString();
        String hash=IdentityService.hash(tenant+":"+board+":"+expected+":"+encoded);
        UUID prior=identities.priorRequest(actor,requestId,"PERSONAL_FOLLOW_BOARD",hash);
        if(prior!=null) {
            int applied=db.queryForObject("SELECT applied_revision FROM personal_follow_board_receipts WHERE id=? AND tenant_id=? AND owner_id=?",Integer.class,prior,tenant,actor);
            return new Receipt(applied,get(actor,tenant,board));
        }
        if(get(actor,tenant,board).revision()!=expected) throw new IdentityException(409,"BRIEFING_LAYOUT_CHANGED");
        db.update("UPDATE personal_follow_boards SET revision=revision+1,preference=?::jsonb WHERE tenant_id=? AND owner_id=? AND board=?",encoded,tenant,actor,board);
        var current=get(actor,tenant,board);UUID receipt=UUID.randomUUID();
        db.update("INSERT INTO personal_follow_board_receipts VALUES(?,?,?,?,?)",receipt,tenant,actor,board,current.revision());
        identities.remember(actor,requestId,"PERSONAL_FOLLOW_BOARD",hash,receipt);
        return new Receipt(current.revision(),current);
    }
}
