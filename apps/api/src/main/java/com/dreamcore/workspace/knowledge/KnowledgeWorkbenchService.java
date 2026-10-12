package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Read-only knowledge workspace projection. Every aggregate uses the same current file ACL. */
@Service
public class KnowledgeWorkbenchService {
 public record Summary(long total,long ready,long processing,long attention,long notStarted) {}
 public record Space(UUID id,String name,long count) {}
 public record Item(UUID id,UUID workspaceId,String workspaceName,String name,int version,String status,Instant updatedAt) {}
 public record Snapshot(UUID tenantId,Instant checkedAt,Summary summary,List<Space> spaces,long filteredTotal,List<Item> items,boolean hasMore) {}
 private final JdbcTemplate db; private final IdentityService identities; private final ObjectMapper json;
 public KnowledgeWorkbenchService(JdbcTemplate db,IdentityService identities,ObjectMapper json){this.db=db;this.identities=identities;this.json=json;}
 private static final String SOURCE="""
 WITH visible AS MATERIALIZED (
 SELECT m.id,m.workspace_id,
   CASE WHEN (library_mask(?,m.tenant_id,'WORKSPACE',w.id)&1)=1 THEN w.name ELSE '共享资料' END workspace_name,
   CASE WHEN (library_mask(?,m.tenant_id,'WORKSPACE',w.id)&1)=1 THEN w.id ELSE NULL END visible_space,
   m.name,m.current_version version,m.updated_at,coalesce(r.status,'NOT_STARTED') status
 FROM active_materials m JOIN workspaces w ON w.tenant_id=m.tenant_id AND w.id=m.workspace_id
 JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.material_id=m.id AND v.workspace_id=m.workspace_id AND v.number=m.current_version
 LEFT JOIN LATERAL (SELECT status FROM knowledge_runs r WHERE r.version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
 WHERE m.tenant_id=? AND w.kind='SHARED' AND NOT w.archived AND m.in_library
   AND (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1
 )
 """;
 @Transactional
 public Snapshot read(UUID actor,UUID tenant,String state,UUID workspace,String query,int offset){
  if(state==null||!Set.of("ALL","READY","PROCESSING","ATTENTION","NOT_STARTED").contains(state)||query==null||query.length()>180||offset<0||offset>100000)throw IdentityException.invalid();
  identities.member(actor,tenant,false);
  Object[] scope={actor,actor,tenant,actor};
  String filter=switch(state){case "READY"->"status='READY'";case "PROCESSING"->"status IN('QUEUED','RUNNING')";case "ATTENTION"->"status IN('PARTIAL','FAILED','UNSUPPORTED','CANCELLED')";case "NOT_STARTED"->"status='NOT_STARTED'";default->"true";};
  String filtered=" , filtered AS (SELECT * FROM visible WHERE "+filter+" AND (?::uuid IS NULL OR visible_space=?::uuid) AND strpos(lower(name),lower(?))>0)";
  var args=new ArrayList<Object>(Arrays.asList(scope));args.add(workspace);args.add(workspace);args.add(query.strip());args.add(offset);
  // A single SQL statement binds counters, distribution and pagination to one MVCC snapshot.
  String payload=db.queryForObject(SOURCE+filtered+"""
   SELECT json_build_object(
    'summary',(SELECT json_build_object('total',count(*),'ready',count(*) FILTER(WHERE status='READY'),
      'processing',count(*) FILTER(WHERE status IN('QUEUED','RUNNING')),
      'attention',count(*) FILTER(WHERE status IN('PARTIAL','FAILED','UNSUPPORTED','CANCELLED')),
      'notStarted',count(*) FILTER(WHERE status='NOT_STARTED')) FROM visible),
    'spaces',coalesce((SELECT json_agg(x ORDER BY x.count DESC,x.name,x.id) FROM
      (SELECT visible_space id,workspace_name name,count(*) count FROM visible GROUP BY visible_space,workspace_name) x),'[]'::json),
    'filteredTotal',(SELECT count(*) FROM filtered),
    'items',coalesce((SELECT json_agg(x ORDER BY x."updatedAt" DESC,x.id) FROM
      (SELECT id,workspace_id "workspaceId",workspace_name "workspaceName",name,version,status,updated_at "updatedAt"
       FROM filtered ORDER BY updated_at DESC,id LIMIT 21 OFFSET ?) x),'[]'::json)
   )::text
   """,String.class,args.toArray());
  try {
   var root=json.readTree(payload);
   Summary summary=json.treeToValue(root.get("summary"),Summary.class);
   List<Space> spaces=Arrays.asList(json.treeToValue(root.get("spaces"),Space[].class));
   List<Item> items=Arrays.asList(json.treeToValue(root.get("items"),Item[].class));
   return new Snapshot(tenant,Instant.now(),summary,spaces,root.get("filteredTotal").asLong(),items.stream().limit(20).toList(),items.size()>20);
  } catch(tools.jackson.core.JacksonException ex){throw new IllegalStateException("Invalid workbench projection",ex);}
 }
}
