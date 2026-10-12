package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** One evaluator for object access; authorization management never grants implicit reading. */
@Service
public class LibraryPermissionService {
    public record Grant(String principalKind, UUID principalId, String content, String download, boolean manageFiles, UUID roleDepartmentId) {}
    public record Change(UUID requestId, int revision, boolean inherit, List<Grant> grants) {}
    public record Effective(boolean canRead, boolean canEdit, boolean canDownload, boolean canManageFiles, boolean canManagePermissions) {}
    public record Policy(String kind, UUID id, UUID workspaceId, int revision, boolean inherit, Effective effective, List<Grant> grants) {}
    public record Person(UUID id, String name) {}
    public record Department(UUID id, String name, int revision, List<UUID> members) {}
    public record Directory(List<Person> people, List<Department> departments) {}
    public record DepartmentChange(UUID requestId, int revision, String name, List<UUID> members) {}
    public record Event(long id, UUID actorId, String actorName, String action, String outcome, Instant occurredAt, String beforeValue, String afterValue, UUID requestId, UUID versionId, String executionSource, Integer httpStatus) {}
    private final JdbcTemplate db; private final IdentityService identities; private final JsonMapper json=new JsonMapper();
    public LibraryPermissionService(JdbcTemplate db,IdentityService identities){this.db=db;this.identities=identities;}
    @Transactional public boolean enabled(UUID actor,UUID tenant){identities.member(actor,tenant,false,false);return Boolean.TRUE.equals(db.queryForObject("SELECT library_permissions_enabled(?)",Boolean.class,tenant));}
    private void requireEnabled(UUID actor,UUID tenant){if(!enabled(actor,tenant))throw new IdentityException(409,"LIBRARY_PERMISSION_ROLLOUT_REQUIRED");}
    public UUID workspace(UUID tenant,String kind,UUID id){
        String table=switch(kind){case "WORKSPACE"->"workspaces";case "FOLDER"->"material_folders";case "MATERIAL"->"materials";default->throw IdentityException.invalid();};
        var rows=db.queryForList("SELECT "+(kind.equals("WORKSPACE")?"id":"workspace_id")+" FROM "+table+" WHERE tenant_id=? AND id=?",UUID.class,tenant,id);
        if(rows.isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");return rows.getFirst();
    }
    public int mask(UUID actor,UUID tenant,String kind,UUID id){return db.queryForObject("SELECT library_mask(?,?,?,?)",Integer.class,actor,tenant,kind,id);}
    public boolean manages(UUID actor,UUID tenant,UUID space){return Boolean.TRUE.equals(db.queryForObject("SELECT library_can_manage(?,?,?)",Boolean.class,actor,tenant,space));}
    public Effective effective(UUID actor,UUID tenant,String kind,UUID id){
        UUID space=workspace(tenant,kind,id);int m=mask(actor,tenant,kind,id);boolean manage=manages(actor,tenant,space);
        return new Effective((m&1)!=0,(m&2)!=0,(m&4)!=0,(m&1)!=0 && ((m&8)!=0||manage),manage);
    }
    public Effective require(UUID actor,UUID tenant,String kind,UUID id,String action){
        identities.member(actor,tenant,false);var e=effective(actor,tenant,kind,id);
        boolean permitted=switch(action){case "READ"->e.canRead();case "EDIT"->e.canEdit();case "DOWNLOAD"->e.canDownload();case "MANAGE_FILES"->e.canManageFiles();case "MANAGE"->e.canManagePermissions();default->false;};
        if(!permitted)throw new IdentityException(action.equals("READ")?404:403,"LIBRARY_PERMISSION_DENIED");return e;
    }
    @Transactional public Policy policy(UUID actor,UUID tenant,String kind,UUID id){
        identities.member(actor,tenant,false);UUID space=workspace(tenant,kind,id);var e=effective(actor,tenant,kind,id);
        if(!e.canRead()&&!e.canManagePermissions())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
        var rows=db.queryForList("SELECT revision,inherit FROM library_policies WHERE tenant_id=? AND object_kind=? AND object_id=?",tenant,kind,id);
        return new Policy(kind,id,space,rows.isEmpty()?0:(Integer)rows.getFirst().get("revision"),rows.isEmpty()||(Boolean)rows.getFirst().get("inherit"),e,e.canManagePermissions()?grants(tenant,kind,id):List.of());
    }
    private List<Grant> grants(UUID tenant,String kind,UUID id){return db.query("SELECT * FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=? ORDER BY principal_kind,principal_id",(r,n)->new Grant(r.getString("principal_kind"),r.getObject("principal_id",UUID.class),r.getString("content"),r.getString("download"),r.getBoolean("manage_files"),r.getObject("role_department_id",UUID.class)),tenant,kind,id);}
    private String fingerprint(Object value){return IdentityService.hash(json.writeValueAsString(value));}
    private String begin(UUID actor,UUID tenant,UUID request,String fingerprint){
        if(request==null)throw IdentityException.invalid();identities.member(actor,tenant,false,false);
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",actor+":"+request);
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);identities.member(actor,tenant,false);
        var old=db.queryForList("SELECT fingerprint,receipt::text FROM library_change_receipts WHERE actor_id=? AND request_id=?",actor,request);
        if(old.isEmpty())return null;if(!fingerprint.equals(old.getFirst().get("fingerprint")))throw new IdentityException(409,"STATE_CONFLICT");return (String)old.getFirst().get("receipt");
    }
    private void receipt(UUID actor,UUID request,String fingerprint,Object result){db.update("INSERT INTO library_change_receipts VALUES (?,?,?,?::jsonb)",actor,request,fingerprint,json.writeValueAsString(result));}
    public void event(UUID actor,UUID tenant,UUID space,String kind,UUID id,String action,Object before,Object after){
        db.update("INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,before_value,after_value,request_id) VALUES (?,?,?,?,?,?,'SUCCESS',?::jsonb,?::jsonb,?)",tenant,space,kind,id,actor,action,before==null?null:json.writeValueAsString(before),after==null?null:json.writeValueAsString(after),IdentityAudit.currentRequestId());
    }
    @Transactional public Policy save(UUID actor,UUID tenant,String kind,UUID id,Change change){
        requireEnabled(actor,tenant);if(change==null||change.revision()<0||change.grants()==null||change.grants().size()>200)throw IdentityException.invalid();
        String fp=fingerprint(new Object[]{tenant,kind,id,change});String old=begin(actor,tenant,change.requestId(),fp);
        require(actor,tenant,kind,id,"MANAGE");Policy before=policy(actor,tenant,kind,id);
        if(old!=null)return before; // Current authorization is rechecked; a replay cannot overwrite newer policy.
        if(before.revision()!=change.revision())throw new IdentityException(409,"LIBRARY_POLICY_CONFLICT");
        if(!"SHARED".equals(db.queryForObject("SELECT kind FROM workspaces WHERE id=?",String.class,before.workspaceId())))throw IdentityException.invalid();
        var keys=new HashSet<String>();
        for(Grant g:change.grants()){
            if(g==null||g.principalId()==null||g.principalKind()==null||g.content()==null||g.download()==null||!Set.of("ACCOUNT","DEPARTMENT").contains(g.principalKind())||!Set.of("NONE","READ","EDIT").contains(g.content())||!Set.of("INHERIT","ALLOW","DENY").contains(g.download())||!keys.add(g.principalKind()+g.principalId())||g.content().equals("NONE")&&g.manageFiles())throw IdentityException.invalid();
            if(g.principalKind().equals("ACCOUNT"))validMember(tenant,g.principalId());else validDepartment(tenant,g.principalId());
            if(g.roleDepartmentId()!=null){validDepartment(tenant,g.roleDepartmentId());if(!g.principalKind().equals("ACCOUNT")||!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_department_members WHERE tenant_id=? AND department_id=? AND account_id=?)",Boolean.class,tenant,g.roleDepartmentId(),g.principalId())))throw IdentityException.invalid();}
        }
        int beforeMask=mask(actor,tenant,kind,id);
        db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id,inherit,revision) VALUES (?,?,?,?,?,1) ON CONFLICT(tenant_id,object_kind,object_id) DO UPDATE SET inherit=EXCLUDED.inherit,revision=library_policies.revision+1",tenant,kind,id,before.workspaceId(),change.inherit());
        db.update("DELETE FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=?",tenant,kind,id);
        for(Grant g:change.grants())db.update("INSERT INTO library_grants VALUES (?,?,?,?,?,?,?,?,?)",tenant,kind,id,g.principalKind(),g.principalId(),g.content(),g.download(),g.manageFiles(),g.roleDepartmentId());
        // No administrator self-escalation while its approval workflow remains unspecified.
        if((mask(actor,tenant,kind,id)&~beforeMask)!=0)throw new IdentityException(403,"LIBRARY_SELF_GRANT_REQUIRES_REVIEW");
        Policy result=policy(actor,tenant,kind,id);event(actor,tenant,before.workspaceId(),kind,id,"PERMISSION_CHANGE",before,result);receipt(actor,change.requestId(),fp,result);return result;
    }
    private void validMember(UUID tenant,UUID account){if(account==null||!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE' AND a.status='ACTIVE')",Boolean.class,tenant,account)))throw IdentityException.invalid();}
    private void validDepartment(UUID tenant,UUID id){if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_departments WHERE tenant_id=? AND id=?)",Boolean.class,tenant,id)))throw IdentityException.invalid();}
    @Transactional public Directory directory(UUID actor,UUID tenant,UUID space){
        identities.member(actor,tenant,false);if(space==null)identities.member(actor,tenant,true);else require(actor,tenant,"WORKSPACE",space,"MANAGE");
        var people=db.query("SELECT a.id,a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE m.tenant_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' ORDER BY a.display_name,a.id",(r,n)->new Person(r.getObject(1,UUID.class),r.getString(2)),tenant);
        var departments=db.query("SELECT * FROM library_departments WHERE tenant_id=? ORDER BY name,id",(r,n)->department(tenant,r.getObject("id",UUID.class)),tenant);return new Directory(people,departments);
    }
    private Department department(UUID tenant,UUID id){return db.queryForObject("SELECT * FROM library_departments WHERE tenant_id=? AND id=?",(r,n)->new Department(id,r.getString("name"),r.getInt("revision"),db.queryForList("SELECT account_id FROM library_department_members WHERE tenant_id=? AND department_id=? ORDER BY account_id",UUID.class,tenant,id)),tenant,id);}
    @Transactional public Department saveDepartment(UUID actor,UUID tenant,UUID id,DepartmentChange change){
        requireEnabled(actor,tenant);if(change==null||change.members()==null||change.members().size()>2000||change.revision()<0||change.members().stream().distinct().count()!=change.members().size())throw IdentityException.invalid();
        identities.member(actor,tenant,true,false);String fp=fingerprint(new Object[]{tenant,id,change});String replay=begin(actor,tenant,change.requestId(),fp);identities.member(actor,tenant,true);
        if(replay!=null)return json.readValue(replay,Department.class);
        String name=MaterialService.name(change.name());change.members().forEach(member->validMember(tenant,member));
        boolean exists=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_departments WHERE tenant_id=? AND id=?)",Boolean.class,tenant,id));
        Department before=exists?department(tenant,id):null;
        if((before==null?0:before.revision())!=change.revision())throw new IdentityException(409,"LIBRARY_POLICY_CONFLICT");
        db.update("INSERT INTO library_departments(id,tenant_id,name,revision) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,revision=library_departments.revision+1 WHERE library_departments.tenant_id=EXCLUDED.tenant_id",id,tenant,name);
        var removed=before==null?List.<UUID>of():before.members().stream().filter(m->!change.members().contains(m)).toList();
        for(UUID account:removed){
            var affected=db.queryForList("SELECT object_kind,object_id FROM library_grants WHERE tenant_id=? AND principal_kind='ACCOUNT' AND principal_id=? AND role_department_id=?",tenant,account,id);
            for(var target:affected){String kind=(String)target.get("object_kind");UUID object=(UUID)target.get("object_id");var grantsBefore=grants(tenant,kind,object);
                db.update("DELETE FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=? AND principal_kind='ACCOUNT' AND principal_id=? AND role_department_id=?",tenant,kind,object,account,id);
                db.update("UPDATE library_policies SET revision=revision+1 WHERE tenant_id=? AND object_kind=? AND object_id=?",tenant,kind,object);
                event(actor,tenant,workspace(tenant,kind,object),kind,object,"ROLE_GRANT_REVOKED",grantsBefore,grants(tenant,kind,object));
            }
        }
        db.update("DELETE FROM library_department_members WHERE tenant_id=? AND department_id=?",tenant,id);
        for(UUID member:change.members())db.update("INSERT INTO library_department_members VALUES (?,?,?)",tenant,id,member);
        Department result=department(tenant,id);event(actor,tenant,null,"DEPARTMENT",id,"DEPARTMENT_MEMBERS_CHANGE",before,result);receipt(actor,change.requestId(),fp,result);return result;
    }
    @Transactional public List<Event> events(UUID actor,UUID tenant,String kind,UUID id,int offset){return events(actor,tenant,kind,id,offset,true);}
    @Transactional public List<Event> events(UUID actor,UUID tenant,String kind,UUID id,int offset,boolean audit){
        if(offset<0||offset>100000)throw IdentityException.invalid();
        identities.member(actor,tenant,false);UUID space=workspace(tenant,kind,id);boolean manager=manages(actor,tenant,space);
        if(audit&&!manager)throw IdentityException.denied();
        if(!manager)require(actor,tenant,kind,id,"READ");
        String filter=audit?"":" AND action IN ('MATERIAL_UPLOAD','MATERIAL_VERSION','MATERIAL_FOLDER_CREATE','MATERIAL_MOVE','MATERIAL_RENAME','MATERIAL_TRASH','MATERIAL_RESTORE') AND outcome='SUCCESS'";
        return db.query("SELECT e.*,(SELECT a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE a.id=e.actor_id AND m.tenant_id=e.tenant_id) AS actor_name FROM library_events e WHERE tenant_id=? AND object_kind=? AND object_id=?"+filter+" ORDER BY occurred_at DESC,id DESC LIMIT 50 OFFSET ?",(r,n)->new Event(r.getLong("id"),r.getObject("actor_id",UUID.class),r.getString("actor_name"),r.getString("action"),r.getString("outcome"),r.getTimestamp("occurred_at").toInstant(),manager?r.getString("before_value"):null,manager?r.getString("after_value"):null,audit?r.getObject("request_id",UUID.class):null,r.getObject("version_id",UUID.class),r.getString("execution_source"),audit?r.getObject("http_status",Integer.class):null),tenant,kind,id,offset);
    }
}
