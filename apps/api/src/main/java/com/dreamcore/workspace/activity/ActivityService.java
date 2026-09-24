package com.dreamcore.workspace.activity;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shared material versions are the durable facts; private task/audit tables never feed this view. */
@Service
public class ActivityService {
    public record Item(UUID id, UUID workspaceId, String workspaceName, UUID folderId, UUID materialId,
                       int version, String filename, String actorName, String kind, Instant occurredAt) {}
    public record Page(UUID tenantId, UUID workspaceId, List<Item> items, String nextCursor) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final MaterialAccess access;
    public ActivityService(JdbcTemplate db, IdentityService identities, MaterialAccess access) {
        this.db=db; this.identities=identities; this.access=access;
    }
    @Transactional
    public Page list(UUID actor, UUID tenant, UUID workspace, String cursor, int limit) {
        if(limit<1 || limit>50) throw IdentityException.invalid();
        Instant before=null; UUID beforeId=null;
        if(cursor!=null) {
            try {
                if(cursor.length()>100) throw new IllegalArgumentException();
                String[] parts=cursor.split("~",-1);
                if(parts.length!=2) throw new IllegalArgumentException();
                before=Instant.parse(parts[0]); beforeId=UUID.fromString(parts[1]);
                if(!beforeId.toString().equals(parts[1]) || before.isBefore(Instant.EPOCH) || before.isAfter(Instant.parse("9999-12-31T23:59:59Z"))) throw new IllegalArgumentException();
            } catch(Exception error) { throw IdentityException.invalid(); }
        }
        // Same tenant lock as material reads: permission writers cannot race the visibility query.
        identities.member(actor,tenant,false);
        if(workspace!=null && !access.require(actor,tenant,workspace,false).kind().equals("SHARED"))
            throw new IdentityException(404,"MATERIAL_LOCATION_UNAVAILABLE");
        var args=new ArrayList<Object>(List.of(actor,tenant));
        String sql="""
            SELECT v.id,v.workspace_id,w.name AS workspace_name,m.folder_id,v.material_id,v.number,
                   v.filename,a.display_name,v.created_at,
                   CASE WHEN p.id IS NOT NULL THEN CASE WHEN v.number=1 THEN 'DOCUMENT_PUBLISHED' ELSE 'DOCUMENT_UPDATED' END
                        ELSE CASE WHEN v.number=1 THEN 'MATERIAL_UPLOADED' ELSE 'MATERIAL_UPDATED' END END AS kind
            FROM material_versions v
            JOIN workspaces w ON w.tenant_id=v.tenant_id AND w.id=v.workspace_id AND w.kind='SHARED'
            JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            JOIN materials m ON m.tenant_id=v.tenant_id AND m.workspace_id=v.workspace_id AND m.id=v.material_id
            JOIN accounts a ON a.id=v.created_by
            LEFT JOIN document_publications p ON p.tenant_id=v.tenant_id AND p.material_version_id=v.id
            WHERE v.tenant_id=?
            """;
        if(workspace!=null) { sql+=" AND v.workspace_id=?"; args.add(workspace); }
        if(before!=null) { sql+=" AND (v.created_at,v.id)<(?,?)"; args.add(Timestamp.from(before)); args.add(beforeId); }
        sql+=" ORDER BY v.created_at DESC,v.id DESC LIMIT ?"; args.add(limit+1);
        db.execute("SET LOCAL statement_timeout='3s'");
        var rows=db.query(sql,(r,n)->new Item(r.getObject("id",UUID.class),r.getObject("workspace_id",UUID.class),r.getString("workspace_name"),r.getObject("folder_id",UUID.class),r.getObject("material_id",UUID.class),r.getInt("number"),r.getString("filename"),r.getString("display_name"),r.getString("kind"),r.getTimestamp("created_at").toInstant()),args.toArray());
        var items=rows.stream().limit(limit).toList();
        String next=null;
        if(rows.size()>limit) { var last=items.getLast(); next=last.occurredAt()+"~"+last.id(); }
        return new Page(tenant,workspace,items,next);
    }
}
