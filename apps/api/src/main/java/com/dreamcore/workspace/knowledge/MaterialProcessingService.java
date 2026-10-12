package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A management projection of the same shared library, never a second content store. */
@Service
public class MaterialProcessingService {
    public record Summary(long total,long ready,long processing,long attention,long notStarted) {}
    public record Item(UUID materialId,UUID workspaceId,String workspaceName,String name,UUID versionId,int version,long sizeBytes,
                       String status,int generation,Instant updatedAt,Instant finishedAt,boolean canMaintain) {}
    public record Page(UUID tenantId,UUID workspaceId,String query,String state,boolean parserAvailable,int maxUploadBytes,Summary summary,List<Item> items,boolean hasMore) {}
    private final JdbcTemplate db; private final IdentityService identities; private final MaterialAccess access; private final boolean enabled; private final int maxBytes;
    public MaterialProcessingService(JdbcTemplate db,IdentityService identities,MaterialAccess access,@Value("${dreamcore.knowledge.enabled:false}") boolean enabled,@Value("${dreamcore.material.max-bytes:20971520}") int maxBytes){this.db=db;this.identities=identities;this.access=access;this.enabled=enabled;this.maxBytes=maxBytes;}
    private static final String SOURCE="""
      WITH visible AS (
       SELECT m.id material_id,m.workspace_id,CASE WHEN (library_mask(?,m.tenant_id,'WORKSPACE',w.id)&1)=1 THEN w.name ELSE '共享资料' END workspace_name,m.name,v.id version_id,v.number version,v.size_bytes,m.updated_at,
        coalesce(r.status,'NOT_STARTED') status,coalesce(r.generation,0) generation,r.finished_at,
        ((library_mask(?,m.tenant_id,'MATERIAL',m.id)&2)=2 AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=m.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED')) can_maintain
       FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id AND w.kind='SHARED'
       JOIN material_versions v ON v.material_id=m.id AND v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.number=m.current_version
       LEFT JOIN LATERAL (SELECT status,generation,finished_at FROM knowledge_runs r WHERE r.version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
       WHERE m.tenant_id=? AND m.in_library AND (?::uuid IS NULL OR m.workspace_id=?::uuid)
        AND NOT w.archived AND (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1
      )
      """;
    @Transactional
    public Page list(UUID actor,UUID tenant,UUID workspace,String query,String state,int offset,int limit){
        if(query==null||query.length()>180||state==null||!Set.of("ALL","READY","PROCESSING","ATTENTION","NOT_STARTED").contains(state)||offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();
        identities.member(actor,tenant,false);
        if(workspace!=null && !"SHARED".equals(access.requireObject(actor,tenant,workspace,"WORKSPACE",workspace,false).kind()))throw new IdentityException(404,"MATERIAL_LOCATION_UNAVAILABLE");
        Object[] scope={actor,actor,tenant,workspace,workspace,actor};
        var summary=db.queryForObject(SOURCE+"""
          SELECT count(*) total,count(*) FILTER(WHERE status='READY') ready,
           count(*) FILTER(WHERE status IN ('QUEUED','RUNNING')) processing,
           count(*) FILTER(WHERE status IN ('PARTIAL','FAILED','UNSUPPORTED','CANCELLED')) attention,
           count(*) FILTER(WHERE status='NOT_STARTED') not_started FROM visible
          """,(r,n)->new Summary(r.getLong("total"),r.getLong("ready"),r.getLong("processing"),r.getLong("attention"),r.getLong("not_started")),scope);
        String filter=switch(state){case "READY"->"status='READY'";case "PROCESSING"->"status IN ('QUEUED','RUNNING')";case "ATTENTION"->"status IN ('PARTIAL','FAILED','UNSUPPORTED','CANCELLED')";case "NOT_STARTED"->"status='NOT_STARTED'";default->"true";};
        var args=new ArrayList<Object>(Arrays.asList(scope));String q=query.strip();args.add(q);args.add(limit+1);args.add(offset);
        var rows=db.query(SOURCE+"SELECT * FROM visible WHERE "+filter+" AND strpos(lower(name),lower(?))>0 ORDER BY updated_at DESC,material_id LIMIT ? OFFSET ?",(r,n)->new Item(r.getObject("material_id",UUID.class),r.getObject("workspace_id",UUID.class),r.getString("workspace_name"),r.getString("name"),r.getObject("version_id",UUID.class),r.getInt("version"),r.getLong("size_bytes"),r.getString("status"),r.getInt("generation"),r.getTimestamp("updated_at").toInstant(),r.getTimestamp("finished_at")==null?null:r.getTimestamp("finished_at").toInstant(),r.getBoolean("can_maintain")),args.toArray());
        return new Page(tenant,workspace,q,state,enabled,maxBytes,summary,rows.stream().limit(limit).toList(),rows.size()>limit);
    }
}
