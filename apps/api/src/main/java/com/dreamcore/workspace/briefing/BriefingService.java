package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.conversation.TaskOriginals;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BriefingService {
    public record Preference(int revision, boolean pinned, boolean hidden, String size) {}
    public record Card(UUID conversationId, UUID taskId, int taskRevision, int attempt, String presentationVersion, UUID workspaceId, String workspaceName, String title,
                       String excerpt, boolean truncated, Instant completedAt, String executionClass, String engineVersion,
                       int artifactCount, int citationCount, int originalCount, Preference preference) {}
    public record Page(UUID tenantId, String view, String date, String zone, List<Card> items, boolean hasMore) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final MaterialAccess access;
    private final TaskOriginals originals;
    private final KnowledgeService knowledge;
    private final IdentityAudit audit;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public BriefingService(JdbcTemplate db, IdentityService identities, MaterialAccess access, TaskOriginals originals, KnowledgeService knowledge, IdentityAudit audit,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;
        this.db=db; this.identities=identities; this.access=access; this.originals=originals; this.knowledge=knowledge; this.audit=audit;
    }
    private IdentityException missing() { return new IdentityException(404,"BRIEFING_NOT_FOUND"); }
    @Transactional
    public Page list(UUID actor, UUID tenant, UUID space, String view, String date, String zone, int offset, int limit) {
        if(view==null || !Set.of("LATEST","FOCUSED","HIDDEN").contains(view) || offset<0 || offset>10000 || limit<1 || limit>30 || (date!=null && (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || date.startsWith("0000")))) throw IdentityException.invalid();
        ZoneId timeZone; LocalDate day;
        try { timeZone=ZoneId.of(zone); day=date==null?null:LocalDate.parse(date); if(day!=null && !day.toString().equals(date))throw new IllegalArgumentException(); }
        catch(Exception e) { throw IdentityException.invalid(); }
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        if(space!=null)access.require(actor,tenant,space,false);
        var args=new ArrayList<Object>();
        String range="";
        if(day!=null) {
            range=" AND t.finished_at>=? AND t.finished_at<?";
            args.add(Timestamp.from(day.atStartOfDay(timeZone).toInstant()));
            args.add(Timestamp.from(day.plusDays(1).atStartOfDay(timeZone).toInstant()));
        }
        String sql="""
            SELECT c.id AS conversation_id,c.workspace_id,w.name AS workspace_name,CASE WHEN EXISTS(SELECT 1 FROM readable_source_tasks title_source WHERE title_source.id=(SELECT first_task.id FROM conversation_tasks first_task WHERE first_task.conversation_id=c.id ORDER BY first_task.created_at,first_task.id LIMIT 1)) THEN c.title ELSE '会话内容暂不可用' END AS title,
                   t.id AS task_id,left(t.reply,600) AS excerpt,length(t.reply)>600 AS truncated,t.finished_at,
                   t.execution_class,t.engine_version,t.revision AS task_revision,t.attempt,
                   (SELECT count(*) FROM conversation_artifacts a WHERE a.task_id=t.id AND a.attempt_number=t.attempt) AS artifact_count,
                   (SELECT count(*) FROM conversation_sources s WHERE s.task_id=t.id AND s.attempt_number=t.attempt) AS citation_count,
                   (SELECT count(*) FROM conversation_originals o WHERE o.task_id=t.id) AS original_count,
                   coalesce(p.revision,0) AS pref_revision,coalesce(p.pinned,false) AS pinned,
                   coalesce(p.hidden,false) AS hidden,coalesce(p.size,'STANDARD') AS size
            FROM conversations c
            JOIN workspaces w ON w.id=c.workspace_id AND w.tenant_id=c.tenant_id
            JOIN LATERAL (SELECT * FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.tenant_id=c.tenant_id
                AND t.mode='AGENT' AND t.status='SUCCEEDED' AND t.reply IS NOT NULL AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)
            """+range+"""
                ORDER BY t.finished_at DESC,t.id DESC LIMIT 1) t ON true
            LEFT JOIN briefing_preferences p ON p.conversation_id=c.id AND p.owner_id=c.owner_id
            LEFT JOIN workspace_members g ON g.tenant_id=c.tenant_id AND g.workspace_id=c.workspace_id AND g.account_id=?
            WHERE c.tenant_id=? AND c.owner_id=? AND c.purpose='BUSINESS' AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
            """;
        args.addAll(List.of(actor,tenant,actor,actor));
        if(space!=null) { sql+=" AND c.workspace_id=?"; args.add(space); }
        sql+=" AND coalesce(p.hidden,false)="+(view.equals("HIDDEN")?"true":"false");
        if(view.equals("FOCUSED"))sql+=" AND coalesce(p.pinned,false)=true";
        sql+=view.equals("FOCUSED")?" ORDER BY p.focus_position ASC NULLS LAST,c.id LIMIT ? OFFSET ?":" ORDER BY t.finished_at DESC,c.id LIMIT ? OFFSET ?"; args.add(limit+1); args.add(offset);
        db.execute("SET LOCAL statement_timeout='3s'");
        var found=db.query(sql,(r,n)->new Card(r.getObject("conversation_id",UUID.class),r.getObject("task_id",UUID.class),r.getInt("task_revision"),r.getInt("attempt"),"briefing-basic-v1",r.getObject("workspace_id",UUID.class),r.getString("workspace_name"),r.getString("title"),r.getString("excerpt"),r.getBoolean("truncated"),r.getTimestamp("finished_at").toInstant(),r.getString("execution_class"),r.getString("engine_version"),r.getInt("artifact_count"),r.getInt("citation_count"),r.getInt("original_count"),new Preference(r.getInt("pref_revision"),r.getBoolean("pinned"),r.getBoolean("hidden"),r.getString("size"))),args.toArray());
        var cards=found.stream().limit(limit).toList();
        // Current grants apply even when displaying an old day's immutable task result.
        for(var card:cards) {
            access.require(actor,tenant,card.workspaceId(),false);
            for(UUID id:db.queryForList("SELECT chunk_id FROM conversation_sources WHERE task_id=?",UUID.class,card.taskId()))knowledge.citation(actor,tenant,id);
            originals.list(actor,tenant,card.workspaceId(),card.taskId());
        }
        return new Page(tenant,view,date,timeZone.getId(),cards,found.size()>limit);
    }
    private Preference preference(UUID conversation) {
        var rows=db.query("SELECT * FROM briefing_preferences WHERE conversation_id=?",(r,n)->new Preference(r.getInt("revision"),r.getBoolean("pinned"),r.getBoolean("hidden"),r.getString("size")),conversation);
        return rows.isEmpty()?new Preference(0,false,false,"STANDARD"):rows.getFirst();
    }
    @Transactional
    public Preference readPreference(UUID actor, UUID tenant, UUID conversation) {
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        var spaces=db.queryForList("SELECT workspace_id FROM conversations c WHERE c.tenant_id=? AND c.owner_id=? AND c.purpose='BUSINESS' AND c.id=? AND EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.status='SUCCEEDED' AND t.mode='AGENT')",UUID.class,tenant,actor,conversation);
        if(spaces.isEmpty())throw missing();
        access.require(actor,tenant,spaces.getFirst(),false);
        return preference(conversation);
    }
    @Transactional
    public Preference update(UUID actor,UUID tenant,UUID conversation,UUID requestId,int expectedRevision,boolean pinned,boolean hidden,String size) {
        if(expectedRevision<0 || size==null || !Set.of("STANDARD","WIDE").contains(size))throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(tenant+"\n"+conversation+"\n"+expectedRevision+"\n"+pinned+"\n"+hidden+"\n"+size);
        UUID prior=identities.priorRequest(actor,requestId,"BRIEFING_PREFERENCE",fingerprint);
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        db.update("INSERT INTO briefing_layouts(tenant_id,owner_id) VALUES (?,?) ON CONFLICT DO NOTHING",tenant,actor);
        db.queryForList("SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=? FOR UPDATE",tenant,actor);
        var spaces=db.queryForList("SELECT workspace_id FROM conversations c WHERE c.tenant_id=? AND c.owner_id=? AND c.purpose='BUSINESS' AND c.id=? AND EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.conversation_id=c.id AND t.status='SUCCEEDED' AND t.mode='AGENT') FOR NO KEY UPDATE",UUID.class,tenant,actor,conversation);
        if(spaces.isEmpty())throw missing();
        UUID space=spaces.getFirst();access.require(actor,tenant,space,false);
        if(prior!=null)return preference(conversation);
        var current=preference(conversation);
        if(current.revision()!=expectedRevision)throw new IdentityException(409,"BRIEFING_REVISION_CONFLICT");
        db.update("INSERT INTO briefing_preferences(tenant_id,workspace_id,conversation_id,owner_id,pinned,hidden,size,revision) VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(conversation_id) DO UPDATE SET pinned=excluded.pinned,hidden=excluded.hidden,size=excluded.size,revision=briefing_preferences.revision+1,updated_at=now()",tenant,space,conversation,actor,pinned,hidden,size);
        identities.remember(actor,requestId,"BRIEFING_PREFERENCE",fingerprint,conversation);
        audit.record(actor,tenant,"BRIEFING_PREFERENCE",conversation,"SUCCESS");
        return preference(conversation);
    }
}
