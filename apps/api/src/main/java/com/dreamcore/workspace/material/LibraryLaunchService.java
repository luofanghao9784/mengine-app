package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;
import tools.jackson.databind.json.JsonMapper;

@Service
public class LibraryLaunchService {
    public record Item(String kind,UUID id,UUID workspaceId,String name,boolean canRead,boolean canManagePermissions) {}
    public record Page(List<Item> items,boolean hasMore) {}
    public record Delta(UUID accountId,String name,String kind,UUID objectId,String objectName,int beforeMask,int afterMask) {}
    public record Preview(String fingerprint,int objects,List<Delta> changes) {}
    public record Confirmation(LibraryPermissionService.Change change,String fingerprint) {}
    public record Reason(String scope,String principal,String content,String download,boolean inherit,boolean allowsEffective) {}
    public record PersonAccess(UUID id,String name,int mask) {}
    public record Explanation(List<Reason> reasons,List<PersonAccess> people) {}
    private final JdbcTemplate db;private final IdentityService identities;private final LibraryPermissionService permissions;
    private final JsonMapper json=new JsonMapper();
    public LibraryLaunchService(JdbcTemplate db,IdentityService identities,LibraryPermissionService permissions){this.db=db;this.identities=identities;this.permissions=permissions;}
    private void enabled(UUID actor,UUID tenant){if(!permissions.enabled(actor,tenant))throw new IdentityException(409,"LIBRARY_PERMISSION_ROLLOUT_REQUIRED");}
    private void paging(String query,int offset){if(query==null||query.length()>160||offset<0||offset>100000)throw IdentityException.invalid();}
    @Transactional public Page locate(UUID actor,UUID tenant,String mode,String query,int offset){
        enabled(actor,tenant);paging(query,offset);if(!Set.of("MANAGE","SHARED").contains(mode))throw IdentityException.invalid();
        // MANAGE returns metadata only. File content and version APIs still enforce reading rights.
        String condition=mode.equals("MANAGE")?"library_can_manage(?,o.tenant_id,o.workspace_id)":"o.kind='MATERIAL' AND (library_mask(?,o.tenant_id,o.kind,o.id)&1)=1 AND (library_mask(?,o.tenant_id,'WORKSPACE',o.workspace_id)&1)=0";
        List<Object> args=new ArrayList<>(List.of(actor,actor,tenant));args.add(actor);if(mode.equals("SHARED"))args.add(actor);args.add(query);args.add(offset);
        var items=db.query("SELECT o.*, (library_mask(?,o.tenant_id,o.kind,o.id)&1)=1 can_read,library_can_manage(?,o.tenant_id,o.workspace_id) can_manage FROM ("+LibraryPrivilegeGuard.OBJECTS+") o JOIN workspaces w ON w.id=o.workspace_id AND w.kind='SHARED' AND NOT w.archived WHERE o.tenant_id=? AND "+condition+" AND position(lower(?) in lower(o.name))>0 AND (o.kind='WORKSPACE' OR o.kind='FOLDER' AND EXISTS(SELECT 1 FROM active_material_folders f WHERE f.id=o.id) OR o.kind='MATERIAL' AND EXISTS(SELECT 1 FROM active_materials m WHERE m.id=o.id AND m.in_library)) ORDER BY o.kind,o.name,o.id LIMIT 31 OFFSET ?",(r,n)->new Item(r.getString("kind"),r.getObject("id",UUID.class),r.getObject("workspace_id",UUID.class),r.getString("name"),r.getBoolean("can_read"),r.getBoolean("can_manage")),args.toArray());
        return new Page(items.stream().limit(30).toList(),items.size()>30);
    }
    private List<Delta> state(UUID tenant){
        var objects=db.queryForList("SELECT count(*) FROM ("+LibraryPrivilegeGuard.OBJECTS+") o WHERE tenant_id=?",Long.class,tenant).getFirst();
        long people=db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND status='ACTIVE'",Long.class,tenant);
        if(objects*people>20000)throw new IdentityException(409,"LIBRARY_POLICY_PREVIEW_TOO_LARGE");
        return db.query("SELECT a.id account_id,a.display_name,o.kind,o.id,o.name,library_mask(a.id,o.tenant_id,o.kind,o.id) mask FROM ("+LibraryPrivilegeGuard.OBJECTS+") o JOIN tenant_memberships m ON m.tenant_id=o.tenant_id AND m.status='ACTIVE' JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE' WHERE o.tenant_id=? ORDER BY o.kind,o.id,a.id",(r,n)->new Delta(r.getObject("account_id",UUID.class),r.getString("display_name"),r.getString("kind"),r.getObject("id",UUID.class),r.getString("name"),r.getInt("mask"),r.getInt("mask")),tenant);
    }
    @Transactional public Preview preview(UUID actor,UUID tenant,String kind,UUID id,LibraryPermissionService.Change change){
        enabled(actor,tenant);identities.member(actor,tenant,false,false);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        permissions.require(actor,tenant,kind,id,"MANAGE");
        var before=state(tenant);var policy=permissions.policy(actor,tenant,kind,id);
        var point=TransactionAspectSupport.currentTransactionStatus().createSavepoint();
        List<Delta> after;
        try{permissions.save(actor,tenant,kind,id,change);after=state(tenant);}finally{
            TransactionAspectSupport.currentTransactionStatus().rollbackToSavepoint(point);TransactionAspectSupport.currentTransactionStatus().releaseSavepoint(point);
        }
        var changes=new ArrayList<Delta>();
        for(int i=0;i<before.size();i++){var b=before.get(i);var a=after.get(i);if(b.beforeMask()!=a.beforeMask()){
            boolean manages=permissions.manages(actor,tenant,permissions.workspace(tenant,b.kind(),b.objectId()));
            changes.add(new Delta(b.accountId(),b.name(),b.kind(),manages?b.objectId():null,manages?b.objectName():"其他范围的关联成果",b.beforeMask(),a.beforeMask()));
        }}
        String fp=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,kind,id,change,policy,before,after}));
        return new Preview(fp,(int)before.stream().map(Delta::objectId).distinct().count(),changes);
    }
    @Transactional public LibraryPermissionService.Policy confirm(UUID actor,UUID tenant,String kind,UUID id,Confirmation command){
        if(command==null||command.change()==null||command.fingerprint()==null)throw IdentityException.invalid();
        enabled(actor,tenant);identities.member(actor,tenant,false,false);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        permissions.require(actor,tenant,kind,id,"MANAGE");
        // Replaying a committed request rechecks current authority and delegates payload conflict checking.
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_change_receipts WHERE actor_id=? AND request_id=?)",Boolean.class,actor,command.change().requestId())))return permissions.save(actor,tenant,kind,id,command.change());
        var current=preview(actor,tenant,kind,id,command.change());
        if(!current.fingerprint().equals(command.fingerprint()))throw new IdentityException(409,"LIBRARY_POLICY_PREVIEW_STALE");
        var result=permissions.save(actor,tenant,kind,id,command.change());
        permissions.event(actor,tenant,result.workspaceId(),kind,id,"PERMISSION_IMPACT",null,current.changes());return result;
    }
    @Transactional public Explanation explain(UUID actor,UUID tenant,String kind,UUID id){
        enabled(actor,tenant);var policy=permissions.policy(actor,tenant,kind,id);boolean manage=policy.effective().canManagePermissions();
        var reasons=new ArrayList<Reason>();String k=kind;UUID target=id;boolean allows=true;
        for(int depth=0;depth<34;depth++){
            String table=k.equals("WORKSPACE")?"workspaces":k.equals("FOLDER")?"material_folders":"materials";
            String label=manage||permissions.mask(actor,tenant,k,target)>0?db.queryForObject("SELECT name FROM "+table+" WHERE tenant_id=? AND id=?",String.class,tenant,target):"上级范围";
            boolean inherit=!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_policies WHERE tenant_id=? AND object_kind=? AND object_id=? AND NOT inherit)",Boolean.class,tenant,k,target));
            final boolean inherited=inherit,allowed=allows;final String scope=label;
            String self=manage?"":" AND ((g.principal_kind='ACCOUNT' AND g.principal_id=headquarters_permission_actor(?::uuid,g.tenant_id)) OR (g.principal_kind='DEPARTMENT' AND EXISTS(SELECT 1 FROM library_department_members d WHERE d.tenant_id=g.tenant_id AND d.department_id=g.principal_id AND d.account_id=headquarters_permission_actor(?::uuid,g.tenant_id))))";
            List<Object> args=new ArrayList<>(List.of(tenant,k,target));if(!manage){args.add(actor);args.add(actor);}
            reasons.addAll(db.query("SELECT coalesce(a.display_name,d.name,'历史授权') principal,g.content,g.download FROM library_grants g LEFT JOIN accounts a ON g.principal_kind='ACCOUNT' AND a.id=g.principal_id LEFT JOIN library_departments d ON g.principal_kind='DEPARTMENT' AND d.id=g.principal_id WHERE g.tenant_id=? AND g.object_kind=? AND g.object_id=?"+self+" ORDER BY principal,g.principal_id",(r,n)->new Reason(scope,r.getString("principal"),r.getString("content"),r.getString("download"),inherited,allowed),args.toArray()));
            if(!inherit)allows=false;
            if(k.equals("WORKSPACE")){
                final boolean active=allows;
                args=new ArrayList<>(List.of(tenant,target));if(!manage)args.add(actor);
                reasons.addAll(db.query("SELECT a.display_name,g.can_maintain FROM workspace_members g JOIN accounts a ON a.id=g.account_id WHERE g.tenant_id=? AND g.workspace_id=?"+(manage?"":" AND g.account_id=headquarters_permission_actor(?::uuid,g.tenant_id)")+" ORDER BY a.id",(r,n)->new Reason(scope+"（原空间成员）",r.getString(1),r.getBoolean(2)?"EDIT":"READ","ALLOW",true,active),args.toArray()));break;
            }
            UUID parent=db.queryForObject("SELECT "+(k.equals("MATERIAL")?"folder_id":"parent_id")+" FROM "+table+" WHERE tenant_id=? AND id=?",UUID.class,tenant,target);
            k=parent==null?"WORKSPACE":"FOLDER";target=parent==null?policy.workspaceId():parent;
        }
        var people=manage?db.query("SELECT a.id,a.display_name,library_mask(a.id,m.tenant_id,?,?) mask FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE' WHERE m.tenant_id=? AND m.status='ACTIVE' ORDER BY a.display_name,a.id",(r,n)->new PersonAccess(r.getObject(1,UUID.class),r.getString(2),r.getInt(3)),kind,id,tenant):List.<PersonAccess>of();
        return new Explanation(reasons,people);
    }
    public record ExceptionGrant(UUID accountId,String kind,UUID id,String name,UUID roleDepartmentId,String content,String download) {}
    @Transactional public List<ExceptionGrant> departmentExceptions(UUID actor,UUID tenant,UUID department){
        enabled(actor,tenant);identities.member(actor,tenant,true);
        return db.query("SELECT g.principal_id,g.object_kind,g.object_id,o.name,g.role_department_id,g.content,g.download FROM library_grants g JOIN ("+LibraryPrivilegeGuard.OBJECTS+") o ON o.tenant_id=g.tenant_id AND o.kind=g.object_kind AND o.id=g.object_id WHERE g.tenant_id=? AND g.principal_kind='ACCOUNT' AND EXISTS(SELECT 1 FROM library_department_members d WHERE d.tenant_id=g.tenant_id AND d.department_id=? AND d.account_id=g.principal_id) ORDER BY g.principal_id,g.object_kind,g.object_id",(r,n)->new ExceptionGrant(r.getObject(1,UUID.class),r.getString(2),r.getObject(3,UUID.class),r.getString(4),r.getObject(5,UUID.class),r.getString(6),r.getString(7)),tenant,department);
    }
    @Transactional public List<Map<String,Object>> journal(UUID actor,UUID tenant,int offset){
        enabled(actor,tenant);identities.member(actor,tenant,true);paging("",offset);
        return db.queryForList("SELECT start.request_id,coalesce(finish.actor_id,start.actor_id) actor_id,start.method,start.route,start.recorded_at,coalesce(finish.phase,'PENDING') phase,finish.status FROM library_request_journal start LEFT JOIN LATERAL (SELECT actor_id,phase,status FROM library_request_journal j WHERE j.request_id=start.request_id AND j.phase<>'RECEIVED' ORDER BY j.id DESC LIMIT 1) finish ON true WHERE start.tenant_id=? AND start.phase='RECEIVED' ORDER BY start.id DESC LIMIT 50 OFFSET ?",tenant,offset);
    }
}
