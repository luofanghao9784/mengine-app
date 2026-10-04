package com.dreamcore.workspace.profile;

import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Background statements are data, never authorization grants or scheduling commands. */
@Service
public class ProfileService {
    public enum Scope { TENANT, WORKSPACE, PERSONAL }
    public enum Kind { FACT, INFERENCE, GOAL, PREFERENCE }
    public enum Status { ACTIVE, PROPOSED, WITHDRAWN }
    public record Value(UUID id,UUID versionId,UUID tenantId,Scope scope,UUID subjectId,String key,Kind kind,int revision,
                        String value,String provenance,Status status,String effectiveStatus,Instant expiresAt,UUID changedBy,Instant changedAt) {}
    public record EntryInfo(UUID id,String key,Kind kind,UUID versionId,int revision,boolean bodyAvailable) {}
    public record Page(UUID tenantId,Scope scope,UUID subjectId,boolean canMaintain,List<Value> items,boolean hasMore,List<EntryInfo> entries) {}
    public record VersionInfo(UUID versionId,int revision,boolean current,Status status,String effectiveStatus,Instant expiresAt,Instant changedAt,boolean bodyAvailable) {}
    public record History(boolean canMaintain,List<VersionInfo> items,boolean hasMore) {}
    public record Content(String value,String provenance,Status status,Instant expiresAt) {}
    private final JdbcTemplate db; private final IdentityService identities; private final MaterialAccess materials;
    private final GovernanceAccess governance; private final IdentityAudit audit;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public ProfileService(JdbcTemplate db,IdentityService identities,MaterialAccess materials,GovernanceAccess governance,IdentityAudit audit,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.db=db;this.identities=identities;this.materials=materials;this.governance=governance;this.audit=audit;}
    private static final String SELECT="SELECT e.*,v.value,v.provenance,v.status,v.expires_at,v.changed_by,v.created_at AS changed_at,v.revision AS version_revision,v.id AS version_id,NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AS body_available FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.tenant_id=e.tenant_id ";
    private void read(UUID actor,UUID tenant,Scope scope,UUID subject) {
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        if(subject==null)throw IdentityException.invalid();
        switch(scope){
            case TENANT -> {if(!tenant.equals(subject))throw new IdentityException(404,"PROFILE_NOT_FOUND");}
            case PERSONAL -> {if(!identities.permissionActor(actor,tenant).equals(subject))throw new IdentityException(404,"PROFILE_NOT_FOUND");}
            case WORKSPACE -> materials.require(actor,tenant,subject,false);
        }
    }
    private boolean editable(UUID actor,UUID tenant,Scope scope,UUID subject) {
        return scope==Scope.PERSONAL || governance.allows(actor,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,scope==Scope.WORKSPACE?subject:null);
    }
    private void write(UUID actor,UUID tenant,Scope scope,UUID subject) {
        read(actor,tenant,scope,subject);
        if(!editable(actor,tenant,scope,subject))throw new IdentityException(403,"PROFILE_READ_ONLY");
    }
    private UUID subject(Map<String,Object> e) {
        return switch(Scope.valueOf((String)e.get("scope"))){case TENANT -> (UUID)e.get("tenant_id");case WORKSPACE -> (UUID)e.get("workspace_id");case PERSONAL -> (UUID)e.get("account_id");};
    }
    private Value value(Map<String,Object> row) {
        Instant expiry=row.get("expires_at")==null?null:((java.sql.Timestamp)row.get("expires_at")).toInstant();
        String status=(String)row.get("status");String effective=!status.equals("WITHDRAWN")&&expiry!=null&&!expiry.isAfter(Instant.now())?"EXPIRED":status;
        return new Value((UUID)row.get("id"),(UUID)row.get("version_id"),(UUID)row.get("tenant_id"),Scope.valueOf((String)row.get("scope")),subject(row),(String)row.get("entry_key"),Kind.valueOf((String)row.get("kind")),(Integer)row.get("version_revision"),(String)row.get("value"),(String)row.get("provenance"),Status.valueOf(status),effective,expiry,(UUID)row.get("changed_by"),((java.sql.Timestamp)row.get("changed_at")).toInstant());
    }
    private Map<String,Object> entry(UUID tenant,UUID id,boolean lock){
        var rows=db.queryForList("SELECT * FROM profile_entries WHERE tenant_id=? AND id=?"+(lock?" FOR UPDATE":""),tenant,id);
        if(rows.isEmpty())throw new IdentityException(404,"PROFILE_NOT_FOUND");return rows.getFirst();
    }
    @Transactional public Page list(UUID actor,UUID tenant,Scope scope,UUID subject,int offset,int limit) {
        if(offset<0||offset>100000||limit<1||limit>100)throw IdentityException.invalid();read(actor,tenant,scope,subject);
        var rows=db.queryForList(SELECT+" WHERE e.tenant_id=? AND e.scope=? AND e.workspace_id IS NOT DISTINCT FROM ?::uuid AND e.account_id IS NOT DISTINCT FROM ?::uuid AND v.revision=e.revision ORDER BY e.entry_key,e.id LIMIT ? OFFSET ?",tenant,scope.name(),scope==Scope.WORKSPACE?subject:null,scope==Scope.PERSONAL?subject:null,limit+1,offset);
        return new Page(tenant,scope,subject,editable(actor,tenant,scope,subject),rows.stream().limit(limit).filter(r->Boolean.TRUE.equals(r.get("body_available"))).map(this::value).toList(),rows.size()>limit,rows.stream().limit(limit).map(r->new EntryInfo((UUID)r.get("id"),(String)r.get("entry_key"),Kind.valueOf((String)r.get("kind")),(UUID)r.get("version_id"),(Integer)r.get("version_revision"),Boolean.TRUE.equals(r.get("body_available")))).toList());
    }
    @Transactional public Value get(UUID actor,UUID tenant,UUID id,Integer version) {
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var e=entry(tenant,id,false);read(actor,tenant,Scope.valueOf((String)e.get("scope")),subject(e));
        int revision=version==null?(Integer)e.get("revision"):version;
        var rows=db.queryForList(SELECT+" WHERE e.tenant_id=? AND e.id=? AND v.revision=? AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id)",tenant,id,revision);
        if(rows.isEmpty())throw new IdentityException(404,"PROFILE_VERSION_NOT_FOUND");return value(rows.getFirst());
    }
    @Transactional public History history(UUID actor,UUID tenant,UUID id,int offset,int limit){
        if(offset<0||offset>100000||limit<1||limit>100)throw IdentityException.invalid();var e=entry(tenant,id,false);Scope scope=Scope.valueOf((String)e.get("scope"));read(actor,tenant,scope,subject(e));
        var rows=db.query("SELECT v.*,NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) available FROM profile_versions v WHERE v.entry_id=? ORDER BY v.revision DESC LIMIT ? OFFSET ?",(r,n)->{Instant expiry=r.getTimestamp("expires_at")==null?null:r.getTimestamp("expires_at").toInstant();String status=r.getString("status");return new VersionInfo(r.getObject("id",UUID.class),r.getInt("revision"),r.getInt("revision")==((Number)e.get("revision")).intValue(),Status.valueOf(status),!status.equals("WITHDRAWN")&&expiry!=null&&!expiry.isAfter(Instant.now())?"EXPIRED":status,expiry,r.getTimestamp("created_at").toInstant(),r.getBoolean("available"));},id,limit+1,offset);
        return new History(editable(actor,tenant,scope,subject(e)),rows.stream().limit(limit).toList(),rows.size()>limit);
    }
    @Transactional public VersionInfo currentMetadata(UUID actor,UUID tenant,UUID id){return history(actor,tenant,id,0,1).items().getFirst();}
    private String fingerprint(Object... input){return IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(input));}
    private void validate(Content c) {
        if(c==null||c.value()==null||c.value().isBlank()||c.value().length()>4000||c.provenance()==null||c.provenance().isBlank()||c.provenance().length()>500||c.status()==null||c.status()==Status.WITHDRAWN)throw IdentityException.invalid();
    }
    private UUID append(UUID actor,UUID tenant,UUID entry,int revision,Content c) {
        UUID id=UUID.randomUUID();db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,expires_at,changed_by) VALUES (?,?,?,?,?,?,?,?,?)",id,tenant,entry,revision,c.value(),c.provenance(),c.status().name(),c.expiresAt()==null?null:java.sql.Timestamp.from(c.expiresAt()),actor);return id;
    }
    private Value replay(UUID actor,UUID tenant,UUID version) {
        var rows=db.queryForList("SELECT entry_id,revision FROM profile_versions WHERE tenant_id=? AND id=?",tenant,version);
        if(rows.isEmpty())throw new IdentityException(404,"PROFILE_VERSION_NOT_FOUND");
        return get(actor,tenant,(UUID)rows.getFirst().get("entry_id"),(Integer)rows.getFirst().get("revision"));
    }
    @Transactional public Value create(UUID actor,UUID tenant,Scope scope,UUID subject,String key,Kind kind,Content c,UUID request) {
        if(scope==Scope.TENANT&&key!=null&&key.startsWith("company."))throw new IdentityException(409,"PROFILE_MANAGED_COMPANY_INFORMATION");
        validate(c);if(key==null||!key.matches("[\\p{L}\\p{N}_.-]{1,100}")||kind==null)throw IdentityException.invalid();
        String hash=fingerprint(tenant,scope,subject,key,kind,c);UUID prior=identities.priorRequest(actor,request,"PROFILE_CREATE",hash);
        write(actor,tenant,scope,subject);if(prior!=null)return replay(actor,tenant,prior);
        // Serialize creation by its logical key without making every profile update a tenant-wide write lock.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","profile:"+tenant+":"+scope+":"+subject+":"+key);
        if(db.queryForObject("SELECT count(*) FROM profile_entries WHERE tenant_id=? AND scope=? AND workspace_id IS NOT DISTINCT FROM ?::uuid AND account_id IS NOT DISTINCT FROM ?::uuid AND entry_key=?",Integer.class,tenant,scope.name(),scope==Scope.WORKSPACE?subject:null,scope==Scope.PERSONAL?subject:null,key)>0)throw new IdentityException(409,"PROFILE_KEY_EXISTS");
        UUID id=UUID.randomUUID();db.update("INSERT INTO profile_entries(id,tenant_id,scope,workspace_id,account_id,entry_key,kind,created_by) VALUES (?,?,?,?,?,?,?,?)",id,tenant,scope.name(),scope==Scope.WORKSPACE?subject:null,scope==Scope.PERSONAL?subject:null,key,kind.name(),actor);
        UUID saved=append(actor,tenant,id,1,c);identities.remember(actor,request,"PROFILE_CREATE",hash,saved);audit.record(actor,tenant,"PROFILE_CREATE",id,"SUCCESS");return get(actor,tenant,id,1);
    }
    @Transactional public Value save(UUID actor,UUID tenant,UUID id,int expected,Content c,UUID request) {
        identities.member(actor,tenant,false,false);
        validate(c);String hash=fingerprint(tenant,id,expected,c);UUID prior=identities.priorRequest(actor,request,"PROFILE_SAVE",hash);
        var first=entry(tenant,id,false);write(actor,tenant,Scope.valueOf((String)first.get("scope")),subject(first));
        if(!db.queryForList("SELECT profile_id FROM company_information_tags WHERE profile_id=?",id).isEmpty())throw new IdentityException(409,"PROFILE_MANAGED_COMPANY_INFORMATION");
        if(prior!=null)return replay(actor,tenant,prior);var e=entry(tenant,id,true);
        if(expected<1||expected!=(Integer)e.get("revision"))throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");
        int next=expected+1;UUID saved=append(actor,tenant,id,next,c);db.update("UPDATE profile_entries SET revision=? WHERE id=?",next,id);
        identities.remember(actor,request,"PROFILE_SAVE",hash,saved);audit.record(actor,tenant,"PROFILE_SAVE",id,"SUCCESS");return get(actor,tenant,id,next);
    }
    @Transactional public Value withdraw(UUID actor,UUID tenant,UUID id,int expected,UUID request) {
        identities.member(actor,tenant,false,false);
        String hash=fingerprint(tenant,id,expected);UUID prior=identities.priorRequest(actor,request,"PROFILE_WITHDRAW",hash);
        var first=entry(tenant,id,false);write(actor,tenant,Scope.valueOf((String)first.get("scope")),subject(first));
        if(!db.queryForList("SELECT profile_id FROM company_information_tags WHERE profile_id=?",id).isEmpty())throw new IdentityException(409,"PROFILE_MANAGED_COMPANY_INFORMATION");
        if(prior!=null)return replay(actor,tenant,prior);var e=entry(tenant,id,true);
        if(expected<1||expected!=(Integer)e.get("revision"))throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");
        var current=get(actor,tenant,id,expected);int next=expected+1;
        UUID saved=append(actor,tenant,id,next,new Content(current.value(),current.provenance(),Status.WITHDRAWN,current.expiresAt()));
        db.update("UPDATE profile_entries SET revision=? WHERE id=?",next,id);identities.remember(actor,request,"PROFILE_WITHDRAW",hash,saved);audit.record(actor,tenant,"PROFILE_WITHDRAW",id,"SUCCESS");return get(actor,tenant,id,next);
    }
}
