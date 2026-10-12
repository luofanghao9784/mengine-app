package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Same-space relocation preserves immutable file/version IDs and existing explicit grants. */
@Service
public class LibraryMoveService {
    public record Proposal(UUID destinationFolderId, boolean inheritDestination) {}
    public record Commit(UUID requestId, String expectedFingerprint, UUID destinationFolderId, boolean inheritDestination) {}
    public record ObjectRef(String kind,UUID id,String name,int depth) {}
    public record AccessChange(UUID accountId,String name,UUID objectId,String objectName,int beforeMask,int afterMask) {}
    public record Preview(String fingerprint,UUID workspaceId,String kind,UUID objectId,UUID sourceFolderId,UUID destinationFolderId,
                          String destinationName,boolean inheritDestination,boolean independent,int objects,List<AccessChange> changes,boolean canConfirm) {}
    public record Receipt(UUID objectId,String kind,UUID workspaceId,UUID destinationFolderId,boolean inheritDestination,Instant occurredAt) {}
    public record Destination(UUID id,String name) {}
    private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final LibraryPermissionService permissions;
    private final JsonMapper json=new JsonMapper();
    public LibraryMoveService(JdbcTemplate db,IdentityService identities,MaterialAccess access,LibraryPermissionService permissions){this.db=db;this.identities=identities;this.access=access;this.permissions=permissions;}
    private void enabled(UUID actor,UUID tenant){if(!permissions.enabled(actor,tenant))throw new IdentityException(409,"LIBRARY_PERMISSION_ROLLOUT_REQUIRED");}
    private String table(String kind){return switch(kind){case "MATERIAL"->"materials";case "FOLDER"->"material_folders";default->throw IdentityException.invalid();};}
    private List<ObjectRef> objects(UUID tenant,UUID space,String kind,UUID id){
        if(kind.equals("MATERIAL"))return db.query("SELECT id,name FROM materials WHERE tenant_id=? AND workspace_id=? AND id=?",(r,n)->new ObjectRef(kind,id,r.getString("name"),0),tenant,space,id);
        return db.query("""
          WITH RECURSIVE tree AS (
            SELECT id,name,parent_id,0 depth FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=?
            UNION ALL SELECT f.id,f.name,f.parent_id,t.depth+1 FROM material_folders f JOIN tree t ON f.parent_id=t.id
            WHERE f.tenant_id=? AND f.workspace_id=? AND t.depth<33
          ) SELECT 'FOLDER' kind,id,name,depth FROM tree
          UNION ALL SELECT 'MATERIAL',m.id,m.name,t.depth+1 FROM materials m JOIN tree t ON t.id=m.folder_id
            WHERE m.tenant_id=? AND m.workspace_id=? ORDER BY kind,id LIMIT 501
          """,(r,n)->new ObjectRef(r.getString("kind"),r.getObject("id",UUID.class),r.getString("name"),r.getInt("depth")),tenant,space,id,tenant,space,tenant,space);
    }
    private UUID parent(UUID tenant,String kind,UUID id){return db.queryForObject("SELECT "+(kind.equals("MATERIAL")?"folder_id":"parent_id")+" FROM "+table(kind)+" WHERE tenant_id=? AND id=?",UUID.class,tenant,id);}
    @Transactional public List<Destination> destinations(UUID actor,UUID tenant,UUID space,String kind,UUID id){
        enabled(actor,tenant);identities.member(actor,tenant,false);access.requireManageFiles(actor,tenant,space,kind,id);
        if(!permissions.workspace(tenant,kind,id).equals(space))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
        Set<UUID> excluded=new HashSet<>();if(kind.equals("FOLDER"))objects(tenant,space,kind,id).stream().filter(o->o.kind().equals("FOLDER")).forEach(o->excluded.add(o.id()));
        // Only writable, readable folders. Paths may contain private names, so show only the folder's own name.
        return db.query("SELECT id,name FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND (library_mask(?,tenant_id,'FOLDER',id)&3)=3 ORDER BY name,id LIMIT 500",(r,n)->new Destination(r.getObject("id",UUID.class),r.getString("name")),tenant,space,actor).stream().filter(d->!excluded.contains(d.id())).toList();
    }
    @Transactional public Preview preview(UUID actor,UUID tenant,UUID space,String kind,UUID id,Proposal proposal){
        enabled(actor,tenant);identities.member(actor,tenant,false);return calculate(actor,tenant,space,kind,id,proposal);
    }
    private Preview calculate(UUID actor,UUID tenant,UUID space,String kind,UUID id,Proposal proposal){
        table(kind);if(proposal==null)throw IdentityException.invalid();
        access.requireObject(actor,tenant,space,kind,id,false);access.requireManageFiles(actor,tenant,space,kind,id);
        UUID target=proposal.destinationFolderId();
        access.requireObject(actor,tenant,space,target==null?"WORKSPACE":"FOLDER",target==null?space:target,true);
        UUID original=parent(tenant,kind,id);
        if(Objects.equals(original,target))throw new IdentityException(409,"LIBRARY_MOVE_SAME_LOCATION");
        var objects=objects(tenant,space,kind,id);
        if(objects.size()>500)throw new IdentityException(409,"LIBRARY_MOVE_TOO_LARGE");
        for(var o:objects){if(o.kind().equals("FOLDER")&&o.id().equals(target))throw new IdentityException(409,"LIBRARY_MOVE_CYCLE");access.requireManageFiles(actor,tenant,space,o.kind(),o.id());}
        int ancestors=target==null?0:db.queryForObject("WITH RECURSIVE trail AS (SELECT id,parent_id,1 depth FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=? UNION ALL SELECT f.id,f.parent_id,t.depth+1 FROM material_folders f JOIN trail t ON t.parent_id=f.id WHERE f.tenant_id=? AND f.workspace_id=? AND t.depth<34) SELECT max(depth) FROM trail",Integer.class,tenant,space,target,tenant,space);
        int deepest=objects.stream().filter(o->o.kind().equals("FOLDER")).mapToInt(ObjectRef::depth).max().orElse(-1);
        if(ancestors+deepest+1>32)throw new IdentityException(409,"MATERIAL_FOLDER_DEPTH");
        var people=db.queryForList("SELECT a.id,a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE m.tenant_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' ORDER BY a.id",tenant);
        if((long)people.size()*objects.size()>20000)throw new IdentityException(409,"LIBRARY_MOVE_TOO_LARGE");
        var changes=new ArrayList<AccessChange>();
        for(var o:objects)for(var person:people){
            UUID account=(UUID)person.get("id");
            var masks=db.queryForMap("SELECT library_mask(?,?,?,?) before_mask,library_effective_projected_mask(?,?,?,?,?,?,?,?) after_mask",account,tenant,o.kind(),o.id(),account,tenant,o.kind(),o.id(),kind,id,target,proposal.inheritDestination());
            int before=(Integer)masks.get("before_mask"),after=(Integer)masks.get("after_mask");
            if(before!=after)changes.add(new AccessChange(account,(String)person.get("display_name"),o.id(),o.name(),before,after));
        }
        boolean independent=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_policies WHERE tenant_id=? AND object_kind=? AND object_id=? AND NOT inherit)",Boolean.class,tenant,kind,id));
        // Include raw policy and membership facts as well as effective masks: equal current masks must not hide a changed dynamic rule.
        String snapshot=db.queryForObject("""
          SELECT jsonb_build_object(
           'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.object_kind,p.object_id) FROM library_policies p WHERE p.tenant_id=?),
           'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.object_kind,g.object_id,g.principal_kind,g.principal_id) FROM library_grants g WHERE g.tenant_id=?),
           'departmentMembers',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.department_id,d.account_id) FROM library_department_members d WHERE d.tenant_id=?),
           'workspaceMembers',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.workspace_id,g.account_id) FROM workspace_members g WHERE g.tenant_id=?),
           'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.account_id) FROM tenant_memberships m WHERE m.tenant_id=?),
           'folders',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM material_folders f WHERE f.tenant_id=? AND f.workspace_id=?),
           'materials',(SELECT jsonb_agg(jsonb_build_array(m.id,m.folder_id,m.current_version,m.name) ORDER BY m.id) FROM materials m WHERE m.tenant_id=? AND m.workspace_id=?)
          )::text
          """,String.class,tenant,tenant,tenant,tenant,tenant,tenant,space,tenant,space);
        String fp=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,kind,id,proposal,snapshot,people,objects,changes}));
        boolean mayChange=permissions.manages(actor,tenant,space);
        boolean canConfirm=(changes.isEmpty()&&!proposal.inheritDestination())||mayChange;
        // Full per-person ACL details are for authorization managers, not delegated file movers.
        return new Preview(fp,space,kind,id,original,target,target==null?"空间根目录":db.queryForObject("SELECT name FROM material_folders WHERE tenant_id=? AND id=?",String.class,tenant,target),proposal.inheritDestination(),independent,objects.size(),mayChange?changes:List.of(),canConfirm);
    }
    @Transactional public Receipt move(UUID actor,UUID tenant,UUID space,String kind,UUID id,Commit command){
        enabled(actor,tenant);if(command==null||command.requestId()==null||command.expectedFingerprint()==null)throw IdentityException.invalid();
        identities.member(actor,tenant,false,false);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","library-move:"+actor+":"+command.requestId());
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);identities.member(actor,tenant,false);
        if(!permissions.workspace(tenant,kind,id).equals(space))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
        String fp=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,kind,id,command}));
        var prior=db.queryForList("SELECT fingerprint,receipt::text FROM library_move_receipts WHERE actor_id=? AND request_id=?",actor,command.requestId());
        if(!prior.isEmpty()){
            if(!fp.equals(prior.getFirst().get("fingerprint")))throw IdentityException.conflict();
            access.requireObject(actor,tenant,space,kind,id,false);return json.readValue((String)prior.getFirst().get("receipt"),Receipt.class);
        }
        var preview=calculate(actor,tenant,space,kind,id,new Proposal(command.destinationFolderId(),command.inheritDestination()));
        if(!preview.fingerprint().equals(command.expectedFingerprint()))throw new IdentityException(409,"LIBRARY_MOVE_PREVIEW_STALE");
        if(!preview.canConfirm())throw new IdentityException(403,"LIBRARY_MOVE_PERMISSION_MANAGER_REQUIRED");
        if(preview.changes().stream().anyMatch(c->c.accountId().equals(actor)&&(c.afterMask()&~c.beforeMask())!=0))
            throw new IdentityException(403,"LIBRARY_SELF_GRANT_REQUIRES_REVIEW");
        if(command.inheritDestination()){
            db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id,inherit,revision) VALUES (?,?,?,?,true,1) ON CONFLICT(tenant_id,object_kind,object_id) DO UPDATE SET inherit=true,revision=library_policies.revision+1",tenant,kind,id,space);
        }
        db.update("UPDATE "+table(kind)+" SET "+(kind.equals("MATERIAL")?"folder_id":"parent_id")+"=? WHERE tenant_id=? AND workspace_id=? AND id=?",command.destinationFolderId(),tenant,space,id);
        Instant occurred=db.queryForObject("SELECT now()",(r,n)->r.getTimestamp(1).toInstant());
        var receipt=new Receipt(id,kind,space,command.destinationFolderId(),command.inheritDestination(),occurred);
        permissions.event(actor,tenant,space,kind,id,"MATERIAL_MOVE",Map.of("sourceFolder",Objects.toString(preview.sourceFolderId(),"ROOT")),Map.of("destinationFolder",Objects.toString(command.destinationFolderId(),"ROOT"),"objects",preview.objects()));
        for(var child:objects(tenant,space,kind,id))if(!child.id().equals(id))
            permissions.event(actor,tenant,space,child.kind(),child.id(),"MATERIAL_MOVE",null,Map.of("movedAncestor",id,"destinationFolder",Objects.toString(command.destinationFolderId(),"ROOT")));
        if(!preview.changes().isEmpty())permissions.event(actor,tenant,space,kind,id,"MOVE_PERMISSION_CHANGE",null,preview.changes());
        db.update("INSERT INTO library_move_receipts VALUES (?,?,?,?,?::jsonb)",actor,command.requestId(),tenant,fp,json.writeValueAsString(receipt));return receipt;
    }
}
