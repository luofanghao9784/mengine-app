package com.dreamcore.workspace.profile;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Stable company fields are optional background, never identity or authorization settings. */
@Service
public class CompanyInformationService {
    public enum Field { NAME, INDUSTRY, BUSINESS, TERM }
    public record Tag(UUID id,int revision,String label,String meaning,String origin,boolean humanProtected,Instant updatedAt) {}
    public record Group(Field field,int revision,boolean manuallyCleared,List<Tag> tags) {}
    public record Page(UUID tenantId,boolean canMaintain,List<Group> groups) {}
    public record Change(UUID requestId,Field field,Integer expectedRevision,String action,UUID tagId,String label,String meaning) {}
    public record Receipt(UUID requestId,Field field,int revision,String action,UUID tagId) {}
    private final JdbcTemplate db;private final IdentityService identities;private final GovernanceAccess governance;private final IdentityAudit audit;private final DepartureAccess departure;
    private final JsonMapper json=new JsonMapper();
    public CompanyInformationService(JdbcTemplate db,IdentityService identities,GovernanceAccess governance,IdentityAudit audit,DepartureAccess departure){this.db=db;this.identities=identities;this.governance=governance;this.audit=audit;this.departure=departure;}
    private boolean editable(UUID actor,UUID tenant){return governance.allows(actor,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,null);}
    private void read(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);}
    @Transactional public Page get(UUID actor,UUID tenant){
        read(actor,tenant);var groups=new ArrayList<Group>();
        for(Field field:Field.values()){
            var state=db.queryForList("SELECT revision,manually_cleared FROM company_information_groups WHERE tenant_id=? AND field=?",tenant,field.name());
            var tags=db.query("""
              SELECT t.profile_id,t.origin,t.human_protected,v.revision,v.value,v.created_at
              FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id
              JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision
              WHERE t.tenant_id=? AND t.field=? AND v.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id)
              ORDER BY e.created_at,e.id
              """,(r,n)->{var content=json.readTree(r.getString("value"));return new Tag(r.getObject("profile_id",UUID.class),r.getInt("revision"),content.get("label").asString(),content.get("meaning").asString(),r.getString("origin"),r.getBoolean("human_protected"),r.getTimestamp("created_at").toInstant());},tenant,field.name());
            groups.add(new Group(field,state.isEmpty()?0:((Number)state.getFirst().get("revision")).intValue(),!state.isEmpty()&&Boolean.TRUE.equals(state.getFirst().get("manually_cleared")),tags));
        }
        return new Page(tenant,editable(actor,tenant)&&!departure.exiting(tenant),groups);
    }
    private String text(String value,int max){if(value==null)return "";String v=value.strip();if(v.length()>max||v.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10))throw IdentityException.invalid();return v;}
    private UUID append(UUID actor,UUID tenant,UUID id,String label,String meaning,String status){
        int revision=db.queryForObject("SELECT revision FROM profile_entries WHERE id=? FOR UPDATE",Integer.class,id)+1;UUID version=UUID.randomUUID();
        db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES (?,?,?,?,?,'人工调整',?,?)",version,tenant,id,revision,json.writeValueAsString(Map.of("label",label,"meaning",meaning)),status,actor);
        db.update("UPDATE profile_entries SET revision=?,kind='FACT' WHERE id=?",revision,id);
        db.update("UPDATE company_information_tags SET origin='HUMAN',human_protected=true WHERE profile_id=?",id);return version;
    }
    @Transactional public Receipt change(UUID actor,UUID tenant,Change c){
        if(c==null||c.requestId()==null||c.field()==null||c.expectedRevision()==null||c.expectedRevision()<0||!Set.of("ADD","EDIT","REMOVE","CLEAR").contains(Objects.toString(c.action(),"")))throw IdentityException.invalid();
        String label=text(c.label(),160),meaning=text(c.meaning(),1000);
        if(Set.of("ADD","EDIT").contains(c.action())&&(label.isBlank()||c.field()!=Field.TERM&&!meaning.isBlank()))throw IdentityException.invalid();
        if(Set.of("EDIT","REMOVE").contains(c.action())!=(c.tagId()!=null))throw IdentityException.invalid();
        if(Set.of("REMOVE","CLEAR").contains(c.action())&&(!label.isEmpty()||!meaning.isEmpty()))throw IdentityException.invalid();
        read(actor,tenant);departure.requireActiveBusiness(actor,tenant);if(!editable(actor,tenant))throw new IdentityException(403,"PROFILE_READ_ONLY");
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,c.field(),c.expectedRevision(),c.action(),c.tagId(),label,meaning}));
        UUID prior=identities.priorRequest(actor,c.requestId(),"COMPANY_INFORMATION",fingerprint);
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","company-information:"+tenant+":"+c.field());
        prior=identities.priorRequest(actor,c.requestId(),"COMPANY_INFORMATION",fingerprint);
        // The receipt carries only identifiers; replay never restores content or old permissions.
        if(prior!=null)return new Receipt(c.requestId(),c.field(),c.expectedRevision()+1,c.action(),c.tagId()==null&&c.action().equals("ADD")?prior:c.tagId());
        db.update("INSERT INTO company_information_groups(tenant_id,field) VALUES (?,?) ON CONFLICT DO NOTHING",tenant,c.field().name());
        var group=db.queryForMap("SELECT * FROM company_information_groups WHERE tenant_id=? AND field=? FOR UPDATE",tenant,c.field().name());
        if(((Number)group.get("revision")).intValue()!=c.expectedRevision())throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");
        UUID target=c.tagId();
        if(target!=null&&db.queryForList("SELECT e.id FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE t.tenant_id=? AND t.field=? AND t.profile_id=? AND v.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id)",tenant,c.field().name(),target).isEmpty())throw new IdentityException(404,"PROFILE_NOT_FOUND");
        if(c.action().equals("ADD")){
            long count=db.queryForObject("SELECT count(*) FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE t.tenant_id=? AND t.field=? AND v.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id)",Long.class,tenant,c.field().name());
            if(count>=(c.field()==Field.NAME?1:30))throw new IdentityException(409,"COMPANY_TAG_LIMIT");
            target=UUID.randomUUID();db.update("INSERT INTO profile_entries(id,tenant_id,scope,entry_key,kind,created_by) VALUES (?,?,'TENANT',?,'FACT',?)",target,tenant,"company."+c.field().name().toLowerCase(Locale.ROOT)+"."+target,actor);
            db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES (?,?,?,1,?,'人工调整','ACTIVE',?)",UUID.randomUUID(),tenant,target,json.writeValueAsString(Map.of("label",label,"meaning",meaning)),actor);
            db.update("INSERT INTO company_information_tags(profile_id,tenant_id,field,origin,human_protected) VALUES (?,?,?,'HUMAN',true)",target,tenant,c.field().name());
        } else if(c.action().equals("EDIT"))append(actor,tenant,target,label,meaning,"ACTIVE");
        else if(c.action().equals("REMOVE"))append(actor,tenant,target,"","","WITHDRAWN");
        else {
            var ids=db.queryForList("SELECT t.profile_id FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE t.tenant_id=? AND t.field=? AND v.status='ACTIVE' AND NOT v.scrubbed ORDER BY t.profile_id",UUID.class,tenant,c.field().name());
            for(UUID id:ids)append(actor,tenant,id,"","","WITHDRAWN");
        }
        db.update("UPDATE company_information_groups SET revision=revision+1,manually_cleared=?,protect_new_inferences=protect_new_inferences OR ? WHERE tenant_id=? AND field=?",c.action().equals("CLEAR"),Set.of("REMOVE","CLEAR").contains(c.action()),tenant,c.field().name());
        identities.remember(actor,c.requestId(),"COMPANY_INFORMATION",fingerprint,target==null?tenant:target);audit.record(actor,tenant,"COMPANY_INFORMATION_"+c.action(),target==null?tenant:target,"SUCCESS");
        return new Receipt(c.requestId(),c.field(),c.expectedRevision()+1,c.action(),target);
    }
}
