package com.dreamcore.workspace.source;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Date;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Manual acquisition is a real source; declared period coverage is never a model-quality claim. */
@Service
public class SourceService {
    public record Settings(String name,String description,UUID responsibleId,Integer cadenceHours,
                           LocalDate expectedFrom,LocalDate expectedThrough,String status) {}
    public record Source(UUID id,UUID tenantId,UUID workspaceId,String name,String description,
                         UUID responsibleId,Integer cadenceHours,LocalDate expectedFrom,LocalDate expectedThrough,
                         String status,int revision,String coverageState,Instant lastSubmittedAt,Instant dueAt,
                         boolean overdue,boolean canMaintain,Instant updatedAt) {}
    public record Page(List<Source> items,boolean hasMore) {}
    public record Version(UUID materialId,UUID versionId,int number,String filename,String sha256) {}
    public record Submission(UUID id,UUID sourceId,LocalDate coverageFrom,LocalDate coverageThrough,String note,
                             String status,int revision,UUID submittedBy,Instant submittedAt,List<Version> versions,int unavailableVersions) {}
    public record Submissions(List<Submission> items,boolean hasMore) {}
    public record ConfigVersion(int revision,Settings settings,UUID changedBy,Instant effectiveAt) {}
    public record ConfigHistory(List<ConfigVersion> items,boolean hasMore) {}
    private final JdbcTemplate db;
    private final MaterialAccess access;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final JsonMapper json=new JsonMapper();
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public SourceService(JdbcTemplate db,MaterialAccess access,IdentityService identities,IdentityAudit audit,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;
        this.db=db;this.access=access;this.identities=identities;this.audit=audit;
    }
    private IdentityException missing(){return new IdentityException(404,"SOURCE_NOT_FOUND");}
    private void page(int offset,int limit){if(offset<0 || offset>100000 || limit<1 || limit>50)throw IdentityException.invalid();}
    private String text(String value,int max,boolean required){
        if(value==null || value.length()>max || required && value.isBlank() ||
           value.codePoints().anyMatch(c->Character.isISOControl(c) && c!=10 && c!=13 && c!=9))throw IdentityException.invalid();
        return value.strip();
    }
    private Settings normalize(UUID tenant,UUID space,Settings s){
        if(s==null || s.responsibleId()==null || s.status()==null || !Set.of("ACTIVE","PAUSED").contains(s.status()) ||
           s.cadenceHours()!=null && (s.cadenceHours()<1 || s.cadenceHours()>8760) ||
           (s.expectedFrom()==null)!=(s.expectedThrough()==null) ||
           s.expectedFrom()!=null && s.expectedFrom().isAfter(s.expectedThrough()))throw IdentityException.invalid();
        return new Settings(text(s.name(),160,true),text(s.description(),2000,false),s.responsibleId(),s.cadenceHours(),s.expectedFrom(),s.expectedThrough(),s.status());
    }
    private Map<String,Object> row(UUID actor,UUID tenant,UUID space,UUID id,boolean write){
        access.require(actor,tenant,space,write);departure.requireActiveBusiness(actor,tenant);
        var rows=db.queryForList("SELECT * FROM business_sources WHERE tenant_id=? AND workspace_id=? AND id=?"+(write?" FOR UPDATE":""),tenant,space,id);
        if(rows.isEmpty())throw missing();return rows.getFirst();
    }
    private LocalDate date(Object value){return value==null?null:((Date)value).toLocalDate();}
    private Instant instant(Object value){return value==null?null:((java.sql.Timestamp)value).toInstant();}
    private Source project(Map<String,Object> r,boolean canMaintain){
        UUID id=(UUID)r.get("id");LocalDate from=date(r.get("expected_from")),through=date(r.get("expected_through"));
        Instant last=db.queryForObject("SELECT max(submitted_at) FROM business_source_submissions b WHERE source_id=? AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM business_source_versions x JOIN material_versions v ON v.id=x.version_id WHERE x.submission_id=b.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id))",(result,n)->instant(result.getTimestamp(1)),id);
        String coverage="UNKNOWN";
        if(from!=null){
            boolean declared=Boolean.TRUE.equals(db.queryForObject("SELECT coalesce(range_agg(daterange(coverage_from,coverage_through,'[]')) @> daterange(?::date,?::date,'[]'),false) FROM business_source_submissions b WHERE source_id=? AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM business_source_versions x JOIN material_versions v ON v.id=x.version_id WHERE x.submission_id=b.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id))",Boolean.class,from,through,id));
            coverage=declared?"DECLARED":last==null?"MISSING":"GAP";
        }
        Integer cadence=(Integer)r.get("cadence_hours");
        Instant anchor=instant(r.get("due_anchor_at")),qualifying=null;
        if(from==null) qualifying=last;
        else if("DECLARED".equals(coverage)) qualifying=db.queryForObject("SELECT max(submitted_at) FROM business_source_submissions b WHERE source_id=? AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM business_source_versions x JOIN material_versions v ON v.id=x.version_id WHERE x.submission_id=b.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id)) AND coverage_from<=? AND coverage_through>=?",(result,n)->instant(result.getTimestamp(1)),id,through,from);
        if(qualifying!=null && qualifying.isAfter(anchor))anchor=qualifying;
        Instant due=cadence==null?null:anchor.plusSeconds(cadence*3600L);
        return new Source(id,(UUID)r.get("tenant_id"),(UUID)r.get("workspace_id"),(String)r.get("name"),(String)r.get("description"),
            (UUID)r.get("responsible_id"),cadence,from,through,(String)r.get("status"),(Integer)r.get("revision"),coverage,last,due,
            "ACTIVE".equals(r.get("status")) && due!=null && due.isBefore(Instant.now()),canMaintain,instant(r.get("updated_at")));
    }
    @Transactional public Page list(UUID actor,UUID tenant,UUID space,int offset,int limit){
        page(offset,limit);boolean maintain=access.require(actor,tenant,space,false).canMaintain();departure.requireActiveBusiness(actor,tenant);
        var rows=db.queryForList("SELECT * FROM business_sources WHERE tenant_id=? AND workspace_id=? ORDER BY updated_at DESC,id LIMIT ? OFFSET ?",tenant,space,limit+1,offset);
        return new Page(rows.stream().limit(limit).map(r->project(r,maintain)).toList(),rows.size()>limit);
    }
    @Transactional public Source get(UUID actor,UUID tenant,UUID space,UUID id){
        return project(row(actor,tenant,space,id,false),access.require(actor,tenant,space,false).canMaintain());
    }
    @Transactional public Source create(UUID actor,UUID tenant,UUID space,UUID key,Settings settings){
        access.require(actor,tenant,space,true);Settings s=normalize(tenant,space,settings);
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,s}));
        UUID prior=identities.priorRequest(actor,key,"SOURCE_CREATE",fingerprint);
        if(prior!=null)return get(actor,tenant,space,prior);
        access.require(s.responsibleId(),tenant,space,false);
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO business_sources(id,tenant_id,workspace_id,name,description,responsible_id,cadence_hours,expected_from,expected_through,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",id,tenant,space,s.name(),s.description(),s.responsibleId(),s.cadenceHours(),s.expectedFrom(),s.expectedThrough(),s.status(),actor);
        configuration(id,0,s,actor);
        identities.remember(actor,key,"SOURCE_CREATE",fingerprint,id);audit.record(actor,tenant,"SOURCE_CREATE",id,"SUCCESS");return get(actor,tenant,space,id);
    }
    @Transactional public Source update(UUID actor,UUID tenant,UUID space,UUID id,UUID key,int revision,Settings settings){
        access.require(actor,tenant,space,true);Settings s=normalize(tenant,space,settings);
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,id,revision,s}));
        UUID prior=identities.priorRequest(actor,key,"SOURCE_UPDATE",fingerprint);
        var current=row(actor,tenant,space,id,true);if(prior!=null)return get(actor,tenant,space,id);
        if(revision!=(Integer)current.get("revision"))throw new IdentityException(409,"SOURCE_STATE_CHANGED");
        if(!s.responsibleId().equals(current.get("responsible_id")))access.require(s.responsibleId(),tenant,space,false);
        boolean cycleChanged=!Objects.equals(s.cadenceHours(),current.get("cadence_hours")) || !Objects.equals(s.expectedFrom(),date(current.get("expected_from"))) || !Objects.equals(s.expectedThrough(),date(current.get("expected_through")));
        db.update("UPDATE business_sources SET name=?,description=?,responsible_id=?,cadence_hours=?,expected_from=?,expected_through=?,status=?,revision=revision+1,updated_at=now(),due_anchor_at=CASE WHEN ? THEN now() ELSE due_anchor_at END WHERE id=?",s.name(),s.description(),s.responsibleId(),s.cadenceHours(),s.expectedFrom(),s.expectedThrough(),s.status(),cycleChanged,id);
        configuration(id,revision+1,s,actor);
        identities.remember(actor,key,"SOURCE_UPDATE",fingerprint,id);audit.record(actor,tenant,"SOURCE_UPDATE",id,"SUCCESS");return get(actor,tenant,space,id);
    }
    private void configuration(UUID id,int revision,Settings settings,UUID actor){
        db.update("INSERT INTO business_source_config_versions(source_id,revision,settings,changed_by) VALUES (?,?,CAST(? AS jsonb),?)",id,revision,json.writeValueAsString(settings),actor);
    }
    @Transactional public ConfigHistory history(UUID actor,UUID tenant,UUID space,UUID source,int offset,int limit){
        page(offset,limit);row(actor,tenant,space,source,false);
        var found=db.query("SELECT revision,settings,changed_by,effective_at FROM business_source_config_versions WHERE source_id=? ORDER BY revision DESC LIMIT ? OFFSET ?",(r,n)->new ConfigVersion(r.getInt(1),json.readValue(r.getString(2),Settings.class),r.getObject(3,UUID.class),r.getTimestamp(4).toInstant()),source,limit+1,offset);
        return new ConfigHistory(found.stream().limit(limit).toList(),found.size()>limit);
    }
    private List<Version> versions(UUID tenant,UUID space,List<UUID> ids){return versions(tenant,space,ids,false);}
    private List<Version> versions(UUID tenant,UUID space,List<UUID> ids,boolean allowMissing){
        var found=new ArrayList<Version>();
        for(UUID id:ids){
            var rows=db.query("SELECT v.material_id,v.id,v.number,v.filename,v.sha256 FROM material_versions v JOIN active_materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.workspace_id=? AND v.id=?",(r,n)->new Version(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getInt(3),r.getString(4),r.getString(5)),tenant,space,id);
            if(rows.isEmpty()){if(allowMissing)continue;throw new IdentityException(404,"SOURCE_VERSION_UNAVAILABLE");}found.add(rows.getFirst());
        }
        return found;
    }
    @Transactional public Submission submission(UUID actor,UUID tenant,UUID space,UUID source,UUID submission){
        row(actor,tenant,space,source,false);
        var rows=db.queryForList("SELECT * FROM business_source_submissions WHERE tenant_id=? AND workspace_id=? AND source_id=? AND id=?",tenant,space,source,submission);
        if(rows.isEmpty())throw missing();var r=rows.getFirst();
        var ids=db.queryForList("SELECT version_id FROM business_source_versions WHERE submission_id=? ORDER BY version_id",UUID.class,submission);
        var available=versions(tenant,space,ids,true);
        return new Submission(submission,source,date(r.get("coverage_from")),date(r.get("coverage_through")),(String)r.get("note"),(String)r.get("status"),(Integer)r.get("revision"),(UUID)r.get("submitted_by"),instant(r.get("submitted_at")),available,ids.size()-available.size());
    }
    @Transactional public Submissions submissions(UUID actor,UUID tenant,UUID space,UUID source,int offset,int limit){
        page(offset,limit);row(actor,tenant,space,source,false);
        var ids=db.queryForList("SELECT id FROM business_source_submissions WHERE source_id=? ORDER BY submitted_at DESC,id DESC LIMIT ? OFFSET ?",UUID.class,source,limit+1,offset);
        return new Submissions(ids.stream().limit(limit).map(id->submission(actor,tenant,space,source,id)).toList(),ids.size()>limit);
    }
    @Transactional public Submission submit(UUID actor,UUID tenant,UUID space,UUID source,UUID key,LocalDate from,LocalDate through,String note,List<UUID> versionIds){
        access.require(actor,tenant,space,true);
        if(from==null || through==null || from.isAfter(through) || versionIds==null || versionIds.isEmpty() || versionIds.size()>100 || versionIds.stream().anyMatch(Objects::isNull) || new HashSet<>(versionIds).size()!=versionIds.size())throw IdentityException.invalid();
        note=text(note,2000,false);var ids=versionIds.stream().sorted().toList();versions(tenant,space,ids);
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,source,from,through,note,ids}));
        UUID prior=identities.priorRequest(actor,key,"SOURCE_SUBMIT",fingerprint);
        var current=row(actor,tenant,space,source,true);if(prior!=null)return submission(actor,tenant,space,source,prior);
        if(!"ACTIVE".equals(current.get("status")))throw new IdentityException(409,"SOURCE_PAUSED");
        UUID id=UUID.randomUUID();db.update("INSERT INTO business_source_submissions(id,tenant_id,workspace_id,source_id,coverage_from,coverage_through,note,submitted_by) VALUES (?,?,?,?,?,?,?,?)",id,tenant,space,source,from,through,note,actor);
        for(UUID version:ids)db.update("INSERT INTO business_source_versions(submission_id,version_id) VALUES (?,?)",id,version);
        db.update("UPDATE business_sources SET revision=revision+1,updated_at=now() WHERE id=?",source);
        identities.remember(actor,key,"SOURCE_SUBMIT",fingerprint,id);audit.record(actor,tenant,"SOURCE_SUBMIT",source,"SUCCESS");return submission(actor,tenant,space,source,id);
    }
    @Transactional public Submission withdraw(UUID actor,UUID tenant,UUID space,UUID source,UUID id,UUID key,int revision){
        access.require(actor,tenant,space,true);
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,source,id,revision}));
        UUID prior=identities.priorRequest(actor,key,"SOURCE_WITHDRAW",fingerprint);row(actor,tenant,space,source,true);
        Submission old=submission(actor,tenant,space,source,id);if(prior!=null)return old;
        if(old.revision()!=revision || !"ACTIVE".equals(old.status()))throw new IdentityException(409,"SOURCE_STATE_CHANGED");
        db.update("UPDATE business_source_submissions SET status='WITHDRAWN',revision=revision+1 WHERE id=?",id);
        db.update("UPDATE business_sources SET revision=revision+1,updated_at=now() WHERE id=?",source);
        identities.remember(actor,key,"SOURCE_WITHDRAW",fingerprint,id);audit.record(actor,tenant,"SOURCE_WITHDRAW",source,"SUCCESS");return submission(actor,tenant,space,source,id);
    }
}
