package com.dreamcore.workspace.attention;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Read-through work needs. There is no second completion state or generic complete operation. */
@Service
public class AttentionService {
    public record Item(String kind, UUID id, UUID workspaceId, String workspaceName, String title,
        String state, String instruction, String actionLabel, UUID conversationId, int revision, Instant dueAt, Instant changedAt) {}
    public record Page(UUID tenantId, String scope, long total, List<Item> items, boolean hasMore, Instant checkedAt) {}
    private final IdentityService identities; private final NamedParameterJdbcTemplate db; private final JsonMapper json=new JsonMapper();
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public AttentionService(IdentityService identities,JdbcTemplate jdbc,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.identities=identities;this.db=new NamedParameterJdbcTemplate(jdbc);}
    @Transactional public Page list(UUID actor,UUID tenant,boolean managed,int offset,int limit){
        if(offset<0 || offset>100000 || limit<1 || limit>50)throw IdentityException.invalid();
        identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
        String query="""
            WITH spaces AS MATERIALIZED (
              SELECT w.*, (w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AS maintain
              FROM workspaces w LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=:actor
              WHERE w.tenant_id=:tenant AND ((w.kind='PERSONAL' AND w.owner_id=:actor) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
            ), valid_submissions AS (
              SELECT b.* FROM business_source_submissions b WHERE b.tenant_id=:tenant AND b.status='ACTIVE'
              AND NOT EXISTS(SELECT 1 FROM business_source_versions x JOIN material_versions v ON v.id=x.version_id
                WHERE x.submission_id=b.id AND NOT EXISTS(SELECT 1 FROM active_materials m WHERE m.id=v.material_id))
            ), sources AS (
              SELECT s.*, w.name workspace_name,w.maintain,
                coalesce(v.covered,false) AS covered,
                CASE WHEN s.cadence_hours IS NOT NULL THEN greatest(s.due_anchor_at,
                  CASE WHEN s.expected_from IS NULL THEN v.last_at WHEN v.covered THEN v.qualifying_at END)
                  + make_interval(hours=>s.cadence_hours) END AS due_at
              FROM business_sources s JOIN spaces w ON w.id=s.workspace_id
              LEFT JOIN LATERAL (
                SELECT max(submitted_at) AS last_at,
                  range_agg(daterange(coverage_from,coverage_through,'[]')) @> daterange(s.expected_from,s.expected_through,'[]') AS covered,
                  max(submitted_at) FILTER(WHERE coverage_from<=s.expected_through AND coverage_through>=s.expected_from) AS qualifying_at
                FROM valid_submissions WHERE source_id=s.id
              ) v ON true
              WHERE s.status='ACTIVE' AND ((:managed AND w.kind='SHARED' AND w.maintain) OR (NOT :managed AND s.responsible_id=:actor))
            ), items AS (
              SELECT 'TASK' kind,t.id,t.workspace_id,w.name workspace_name,CASE WHEN EXISTS(SELECT 1 FROM readable_source_tasks title_source WHERE title_source.id=(SELECT first_task.id FROM conversation_tasks first_task WHERE first_task.conversation_id=c.id ORDER BY first_task.created_at,first_task.id LIMIT 1)) THEN c.title ELSE '会话内容暂不可用' END AS title,t.status state,
                CASE t.status WHEN 'WAITING_INPUT' THEN '补充所需条件后继续这项工作' WHEN 'PARTIAL' THEN '核对已完成部分，再决定是否继续' ELSE '先核对执行记录与已有结果' END instruction,
                CASE t.status WHEN 'WAITING_INPUT' THEN '补充条件' WHEN 'PARTIAL' THEN '查看并决定' ELSE '核对执行结果' END action_label,
                t.conversation_id,t.revision,NULL::timestamptz due_at,coalesce(t.finished_at,t.created_at) changed_at,
                CASE t.status WHEN 'RESULT_UNKNOWN' THEN 0 ELSE 2 END priority
              FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN spaces w ON w.id=t.workspace_id
              WHERE NOT :managed AND t.tenant_id=:tenant AND t.requested_by=:actor AND c.owner_id=:actor
                AND t.status IN ('WAITING_INPUT','PARTIAL','RESULT_UNKNOWN') AND EXISTS(SELECT 1 FROM readable_source_tasks r WHERE r.id=t.id)
              UNION ALL
              SELECT 'SOURCE',id,workspace_id,workspace_name,name,
                CASE WHEN due_at<now() THEN 'OVERDUE' ELSE 'MISSING_DATA' END,
                CASE WHEN due_at<now() THEN '此来源已到约定更新时间，请核对并补交' ELSE '预计日期范围仍有缺口，请核对覆盖并补交' END,
                CASE WHEN maintain THEN '补交并核对覆盖' ELSE '查看资料缺口' END,
                NULL::uuid,revision,due_at,updated_at,1
              FROM sources WHERE due_at<now() OR (expected_from IS NOT NULL AND NOT covered)
              UNION ALL
              SELECT 'PLAN',p.id,p.workspace_id,w.name,p.goal,
                CASE WHEN p.status='AUTHORIZATION_REQUIRED' THEN 'AUTHORIZATION_REQUIRED' WHEN p.runtime_state='WAITING_DATA' THEN 'MISSING_DATA' ELSE 'PLAN_NEEDS_ATTENTION' END,
                CASE WHEN p.status='AUTHORIZATION_REQUIRED' THEN '当前授权已变化，请检查范围并重新确认委托' WHEN p.runtime_state='WAITING_DATA' THEN '补齐此计划需要的资料后再检查' WHEN p.reason='TOTAL_RUN_LIMIT' THEN '已达到约定执行次数，请检查委托是否继续' ELSE '查看本次运行记录，再决定如何继续' END,
                '查看持续计划',NULL::uuid,p.revision,NULL::timestamptz,p.updated_at,2
              FROM ongoing_plans p JOIN spaces w ON w.id=p.workspace_id
              WHERE NOT :managed AND p.tenant_id=:tenant AND p.owner_id=:actor
                AND (p.status='AUTHORIZATION_REQUIRED' OR (p.status='ACTIVE' AND
                  ((p.runtime_state='WAITING_DATA' AND p.reason IN ('NO_MATERIALS','SOURCE_REQUIRES_ATTENTION')) OR p.runtime_state='NEEDS_ATTENTION')))

            ), selected AS (
              SELECT * FROM items ORDER BY priority,due_at NULLS LAST,changed_at,id LIMIT :limit OFFSET :offset
            )
            SELECT (SELECT count(*) FROM items) total,coalesce(jsonb_agg(jsonb_build_object(
                'kind',kind,'id',id,'workspaceId',workspace_id,'workspaceName',workspace_name,'title',title,
                'state',state,'instruction',instruction,'actionLabel',action_label,'conversationId',conversation_id,
                'revision',revision,'dueAt',due_at,'changedAt',changed_at)
                ORDER BY priority,due_at NULLS LAST,changed_at,id) FILTER(WHERE id IS NOT NULL),'[]') items FROM selected
            """;
        return db.queryForObject(query,Map.of("actor",actor,"tenant",tenant,"managed",managed,"offset",offset,"limit",limit),(r,n)->{
            long total=r.getLong("total");var items=Arrays.asList(json.readValue(r.getString("items"),Item[].class));
            return new Page(tenant,managed?"MANAGED":"MINE",total,items,offset+items.size()<total,Instant.now());
        });
    }
}
