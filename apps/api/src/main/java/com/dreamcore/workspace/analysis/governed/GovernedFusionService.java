package com.dreamcore.workspace.analysis.governed;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.scene.MetricPlan;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** All joins, snapshots and metric versions are selected server-side before a task can be claimed. */
@Service
public class GovernedFusionService {
    private final JdbcTemplate db;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
    public GovernedFusionService(JdbcTemplate db,IdentityAudit audit){this.db=db;this.audit=audit;}
    private IdentityException rejected(String code){return new IdentityException(422,code);}
    private JsonNode tree(Object o){return json.readTree(o.toString());}
    private JsonNode canonical(JsonNode n){
        if(n.isObject()){var out=json.createObjectNode();var keys=new TreeSet<String>();n.properties().forEach(e->keys.add(e.getKey()));for(String k:keys)out.set(k,canonical(n.get(k)));return out;}
        if(n.isArray()){var out=json.createArrayNode();for(var v:n)out.add(canonical(v));return out;}return n;
    }
    public String digest(Object value){return IdentityService.hash(json.writeValueAsString(canonical(json.valueToTree(value))));}
    private Set<String> columns(Object o){var out=new LinkedHashSet<String>();tree(o).forEach(n->out.add(n.asText()));return out;}

    public void prepareQueued(UUID policy){
        for(var t:db.queryForList("""
          SELECT t.*,b.id batch_id FROM conversation_tasks t JOIN briefing_generation_batches b ON b.task_id=t.id
          WHERE b.policy_id=? AND coalesce(b.business_type,'DATA')='DATA' AND t.status='QUEUED'
           AND t.source_scope='SELECTED' AND NOT EXISTS(SELECT 1 FROM governed_fusion_task_plans f WHERE f.task_id=t.id)
          FOR UPDATE OF t
          """,policy)){
            UUID task=(UUID)t.get("id"),tenant=(UUID)t.get("tenant_id"),actor=(UUID)t.get("requested_by");
            var selected=new HashSet<>(db.queryForList("SELECT dataset_id FROM briefing_dataset_selections WHERE task_id=? AND NOT invalidated",UUID.class,task));
            if(selected.isEmpty())continue;
            var candidates=db.queryForList("""
              SELECT l.source_id,l.metadata,d.id,d.name,d.column_names,s.id snapshot_id,s.row_count
              FROM scene_asset_links l JOIN scene_bindings b ON b.tenant_id=l.tenant_id AND b.governance_valid_until>now()
              JOIN business_datasets d ON d.id=l.target_id AND d.tenant_id=l.tenant_id
              LEFT JOIN briefing_dataset_selections p ON p.task_id=? AND p.dataset_id=d.id AND NOT p.invalidated
              JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=coalesce(p.snapshot_id,d.current_snapshot)
              WHERE l.tenant_id=? AND l.kind='TABLE' AND l.active AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
               AND s.row_count BETWEEN 1 AND 100000 AND s.coverage_through>now()-interval '2 hours'
               AND file_dataset_readable(?,d.id) AND (library_mask(?,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1
               AND departure_content_readable(?,d.tenant_id,d.workspace_id)
               AND EXISTS(SELECT 1 FROM workspace_members w WHERE w.tenant_id=d.tenant_id AND w.workspace_id=d.workspace_id AND w.account_id=?)
              ORDER BY l.source_id
              """,task,tenant,actor,actor,actor,actor);
            var sources=new ArrayList<FusionPlanner.Source>();
            for(var c:candidates){
                var metrics=new ArrayList<FusionPlanner.Published>();
                for(var m:db.queryForList("""
                  SELECT m.id,v.version,v.definition FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.published_version
                  JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
                  WHERE m.tenant_id=? AND m.source_id=? AND scene_table_scope(l.metadata)=v.source_scope ORDER BY m.id
                  """,tenant,c.get("source_id")))metrics.add(new FusionPlanner.Published((UUID)m.get("id"),((Number)m.get("version")).intValue(),tree(m.get("definition"))));
                var meta=tree(c.get("metadata"));
                sources.add(new FusionPlanner.Source(c.get("source_id").toString(),(UUID)c.get("id"),(UUID)c.get("snapshot_id"),c.get("name").toString(),meta.path("dictionaryFingerprint").asText(),columns(c.get("column_names")),((Number)c.get("row_count")).intValue(),meta,metrics));
            }
            var choice=new FusionPlanner().choose(tenant,selected,sources);if(choice.isEmpty())continue;
            var candidate=choice.get();
            var results=calculate(candidate,actor);
            var recipe=deliveryPage(candidate,results,actor);if(recipe==null)continue;
            for(var s:recipe.sources())db.update("INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",task,t.get("batch_id"),s.dataset(),s.snapshot());
            String body=json.writeValueAsString(recipe);
            db.update("INSERT INTO governed_fusion_task_plans(task_id,tenant_id,recipe,recipe_sha256) VALUES(?,?,?::jsonb,?)",task,tenant,body,digest(recipe));
            audit.record(actor,tenant,"FUSION_PLAN_FIXED",task,"SUCCESS");
        }
    }

    /** Each metric is executed separately, so the whole enterprise graph need not reside in memory. */
    private List<FusionCalculator.Result> calculate(FusionPlanner.Recipe recipe,UUID actor){
        var results=new ArrayList<FusionCalculator.Result>();
        for(var metric:recipe.calculation().metrics()){
            var one=subset(recipe,Set.of(metric.id()));
            try{results.addAll(new FusionCalculator().calculate(one.calculation(),actor,snapshots(one),(tenant,a,source)->requireSource(a,tenant,source)));}
            catch(FusionCalculator.Rejected invalid){
                // A resource failure is not permission to silently substitute a single-table result.
                throw rejected(invalid.code);
            }
        }
        return List.copyOf(results);
    }
    private FusionPlanner.Recipe subset(FusionPlanner.Recipe r,Set<String> metricIds){
        var metrics=r.calculation().metrics().stream().filter(m->metricIds.contains(m.id())).toList();
        var aliases=new HashSet<String>();var edges=new HashSet<String>();
        for(var m:metrics){aliases.add(m.base());for(var link:m.joins()){aliases.add(link.from());aliases.add(link.to());edges.add(link.from()+":"+link.to());}}
        return new FusionPlanner.Recipe(r.version(),r.sources().stream().filter(b->aliases.contains(b.alias())).toList(),r.measures().stream().filter(m->metricIds.contains(m.id().toString())).toList(),r.relations().stream().filter(e->edges.contains(e.from()+":"+e.to())).toList(),new FusionCalculator.Plan(r.calculation().tenant(),r.calculation().id(),r.calculation().version(),metrics));
    }
    private List<Map<String,Object>> sourceProofs(FusionPlanner.Recipe r){
        var out=new ArrayList<Map<String,Object>>();
        for(var s:r.sources()){
            var one=new FusionPlanner.Recipe(r.version(),List.of(s),r.measures(),r.relations(),r.calculation());var snap=snapshots(one).get(s.alias());
            out.add(Map.of("alias",s.alias(),"name",s.name(),"datasetId",s.dataset(),"snapshotId",s.snapshot(),"sha256",snap.sha256(),"rowCount",snap.rows().size()));
        }
        return out;
    }
    private String planKey(FusionPlanner.Recipe r,List<Map<String,Object>> proofs){
        return digest(Map.of("metrics",r.measures().stream().map(m->List.of(m.id(),m.version(),m.definition())).toList(),"sources",proofs.stream().map(p->List.of(p.get("datasetId"),p.get("sha256"))).toList(),"relations",r.relations()));
    }
    /** Page by actual serialized evidence budget, never a fixed business table or metric count. */
    private FusionPlanner.Recipe deliveryPage(FusionPlanner.Recipe r,List<FusionCalculator.Result> results,UUID actor){
        var byBase=new LinkedHashMap<String,List<FusionCalculator.Metric>>();
        for(var m:r.calculation().metrics())byBase.computeIfAbsent(m.base(),k->new ArrayList<>()).add(m);
        var ordered=new ArrayList<FusionCalculator.Metric>();
        for(int round=0;ordered.size()<r.measures().size();round++)for(var group:byBase.values())if(round<group.size())ordered.add(group.get(round));
        var resultById=new HashMap<String,FusionCalculator.Result>();results.forEach(x->resultById.put(x.metricId(),x));
        var ids=new LinkedHashSet<String>();int bytes=0;
        for(int index=0;index<=ordered.size();index++){
            var next=index<ordered.size()?ordered.get(index):null;
            int size=next==null?0:json.writeValueAsBytes(resultById.get(next.id())).length;
            if(next==null||(!ids.isEmpty()&&bytes+size>20000)){
                var page=subset(r,ids);
                if(page.measures().stream().map(FusionPlanner.Measure::sourceAlias).distinct().count()>=2){
                    var proofs=sourceProofs(page);String key=planKey(page,proofs);
                    boolean delivered=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governed_fusion_receipts f JOIN conversation_tasks t ON t.id=f.task_id WHERE t.tenant_id=? AND t.requested_by=? AND t.status='SUCCEEDED' AND f.evidence->>'planKey'=?)",Boolean.class,r.calculation().tenant(),actor,key));
                    if(!delivered)return page;
                }
                ids.clear();bytes=0;
            }
            if(next!=null){ids.add(next.id());bytes+=size;}
        }
        return null;
    }

    private FusionPlanner.Recipe recipe(UUID task){
        var found=db.queryForList("SELECT recipe,recipe_sha256 FROM governed_fusion_task_plans WHERE task_id=?",task);
        if(found.isEmpty())return null;
        // jsonb normalizes serialization; the digest is over the typed canonical representation.
        var result=json.readValue(found.getFirst().get("recipe").toString(),FusionPlanner.Recipe.class);
        if(!digest(result).equals(found.getFirst().get("recipe_sha256")))throw rejected("FUSION_PLAN_INVALID");
        return result;
    }
    private void requireSource(UUID actor,UUID tenant,FusionCalculator.Snapshot s){
        if(!tenant.equals(s.tenant())||!Boolean.TRUE.equals(db.queryForObject("""
          SELECT EXISTS(SELECT 1 FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id
           JOIN workspace_members w ON w.tenant_id=d.tenant_id AND w.workspace_id=d.workspace_id AND w.account_id=?
           WHERE d.tenant_id=? AND d.id=? AND s.id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
            AND file_dataset_readable(?,d.id) AND (library_mask(?,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1
            AND departure_content_readable(?,d.tenant_id,d.workspace_id))
          """,Boolean.class,actor,tenant,s.dataset(),s.version(),actor,actor,actor)))throw new IdentityException(403,"FUSION_SOURCE_DENIED");
    }
    private Map<String,FusionCalculator.Snapshot> snapshots(FusionPlanner.Recipe r){
        var result=new LinkedHashMap<String,FusionCalculator.Snapshot>();
        for(var b:r.sources()){
            var matches=db.queryForList("SELECT d.tenant_id,d.column_names,s.data_rows,s.row_count,s.collected_at FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id WHERE d.id=? AND s.id=? AND NOT d.scrubbed AND NOT s.scrubbed",b.dataset(),b.snapshot());
            if(matches.size()!=1)throw rejected("FUSION_SNAPSHOT_UNAVAILABLE");var x=matches.getFirst();
            var cols=new ArrayList<>(columns(x.get("column_names")));var rows=new ArrayList<Map<String,String>>();var raw=tree(x.get("data_rows"));
            if(!raw.isArray()||raw.size()!=((Number)x.get("row_count")).intValue()||raw.size()>100000)throw rejected("FUSION_SOURCE_LIMIT");
            for(var row:raw){if(!row.isArray()||row.size()!=cols.size())throw rejected("FUSION_ROW_INVALID");var value=new LinkedHashMap<String,String>();for(int i=0;i<cols.size();i++){var v=row.get(i);if(!v.isNull()&&!v.isTextual())throw rejected("FUSION_ROW_INVALID");value.put(cols.get(i),v.isNull()?null:v.asText());}rows.add(value);}
            String sha=IdentityService.hash(x.get("column_names")+"\n"+x.get("data_rows"));
            result.put(b.alias(),new FusionCalculator.Snapshot((UUID)x.get("tenant_id"),b.dataset(),b.snapshot(),sha,((Timestamp)x.get("collected_at")).toInstant(),new LinkedHashSet<>(cols),rows));
        }
        return result;
    }
    private Map<String,Object> authorize(UUID task,FusionPlanner.Recipe r,boolean pin){
        var t=db.queryForMap("SELECT * FROM conversation_tasks WHERE id=? FOR UPDATE",task);
        UUID actor=(UUID)t.get("requested_by"),tenant=(UUID)t.get("tenant_id");
        if(!tenant.equals(r.calculation().tenant())||!"RUNNING".equals(t.get("status")))throw new IdentityException(403,"FUSION_TASK_DENIED");
        for(var s:r.sources()){
            var current=db.queryForList("""
              SELECT l.metadata FROM scene_asset_links l JOIN scene_bindings b ON b.tenant_id=l.tenant_id AND b.governance_valid_until>now()
              JOIN briefing_dataset_selections p ON p.task_id=? AND p.dataset_id=l.target_id AND p.snapshot_id=? AND NOT p.invalidated
              WHERE l.tenant_id=? AND l.source_id=? AND l.target_id=? AND l.kind='TABLE' AND l.active AND file_dataset_readable(?,l.target_id)
              """,task,s.snapshot(),tenant,s.sourceId(),s.dataset(),actor);
            if(current.size()!=1)throw new IdentityException(403,"FUSION_SOURCE_DENIED");
            var meta=tree(current.getFirst().get("metadata"));
            String fingerprintKey=s.scope().path("dictionarySchemaFingerprint").asText().isBlank()?"dictionaryFingerprint":"dictionarySchemaFingerprint";
            if(!meta.path(fingerprintKey).equals(s.scope().path(fingerprintKey))||!meta.path("dictionary").equals(s.scope().path("dictionary")))throw rejected("FUSION_RELATION_CHANGED");
            if(pin)db.update("INSERT INTO task_dataset_reads(task_id,attempt_number,dataset_id,snapshot_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",task,t.get("attempt"),s.dataset(),s.snapshot());
            if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM task_dataset_reads WHERE task_id=? AND attempt_number=? AND dataset_id=? AND snapshot_id=?)",Boolean.class,task,t.get("attempt"),s.dataset(),s.snapshot())))throw rejected("FUSION_SNAPSHOT_CHANGED");
        }
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT task_datasets_readable(?) AND NOT EXISTS(SELECT 1 FROM task_dataset_fences WHERE task_id=? AND attempt_number=?)",Boolean.class,task,task,t.get("attempt"))))throw new IdentityException(403,"FUSION_SOURCE_DENIED");
        for(var m:r.measures()){
            var b=r.sources().stream().filter(s->s.alias().equals(m.sourceAlias())).findFirst().orElseThrow();
            var current=db.queryForList("""
              SELECT v.definition FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.published_version
              JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
              WHERE m.tenant_id=? AND m.id=? AND m.published_version=? AND l.target_id=? AND scene_table_scope(l.metadata)=v.source_scope FOR SHARE OF m
              """,tenant,m.id(),m.version(),b.dataset());
            if(current.size()!=1||!tree(current.getFirst().get("definition")).equals(m.definition()))throw rejected("FUSION_METRIC_CHANGED");
            if(pin){
                var old=db.queryForList("SELECT version FROM task_metric_reads WHERE task_id=? AND attempt_number=? AND metric_id=?",Integer.class,task,t.get("attempt"),m.id());
                if(!old.isEmpty()&&old.getFirst()!=m.version())throw rejected("FUSION_METRIC_CHANGED");
                db.update("INSERT INTO task_metric_reads(task_id,attempt_number,metric_id,version,dataset_id) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",task,t.get("attempt"),m.id(),m.version(),b.dataset());
            }
            if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM task_metric_reads WHERE task_id=? AND attempt_number=? AND metric_id=? AND version=? AND dataset_id=?)",Boolean.class,task,t.get("attempt"),m.id(),m.version(),b.dataset())))throw rejected("FUSION_METRIC_NOT_READ");
        }
        return t;
    }
    public Object context(UUID task){
        var r=recipe(task);if(r==null)return null;authorize(task,r,true);
        var items=new ArrayList<Object>();
        for(var m:r.measures()){
            var s=r.sources().stream().filter(x->x.alias().equals(m.sourceAlias())).findFirst().orElseThrow();
            items.add(Map.of("metricId",m.id(),"version",m.version(),"definition",m.definition(),"executionRequest",MetricPlan.request(m.definition(),s.dataset(),s.snapshot(),m.id(),m.version())));
        }
        return Map.of("version",r.version(),"metrics",items,"primaryMetricId",r.measures().getFirst().id(),"sources",r.sources().stream().map(s->Map.of("datasetId",s.dataset(),"snapshotId",s.snapshot(),"name",s.name())).toList(),"usage","该任务已在领取前按登记关系图固定跨表融合计划。调用主指标四项选择即执行本页所有指标：沿登记路径关联并独立汇总各事实表，按共同维度对齐。禁止多对多直接累计金额。解读选题中至少两项相关指标，完整表格保留所有指标、来源、路径、统计范围和单位，不自行计算转化率或认定因果。");
    }
    public void validateCurrent(UUID task){var r=recipe(task);if(r==null)throw rejected("FUSION_PLAN_REQUIRED");authorize(task,r,false);}
    public Map<String,Object> enrich(ConversationService.Job job,DatasetCalculationService.Request request,Map<String,Object> base){
        var r=recipe(job.id());if(r==null)return base;
        if(!r.measures().getFirst().id().equals(request.metricId()))throw rejected("FUSION_PRIMARY_REQUIRED");
        var t=authorize(job.id(),r,false);if(!job.token().equals(t.get("lease_token")))throw new IdentityException(403,"FUSION_TASK_DENIED");
        var results=calculate(r,job.actor());authorize(job.id(),r,false);
        var evidence=new LinkedHashMap<String,Object>();evidence.put("version",r.version());
        var proofs=sourceProofs(r);evidence.put("sources",proofs);evidence.put("planKey",planKey(r,proofs));
        evidence.put("relations",r.relations());
        evidence.put("results",results.stream().map(x->{var v=(tools.jackson.databind.node.ObjectNode)json.valueToTree(x);v.put("total",x.groups().stream().map(g->new java.math.BigDecimal(g.value())).reduce(java.math.BigDecimal.ZERO,java.math.BigDecimal::add).toPlainString());return v;}).toList());
        var dimensions=r.calculation().metrics().getFirst().dimensions();String anchor=dimensions.getFirst().field().source();
        var binding=r.sources().stream().filter(b->b.alias().equals(anchor)).findFirst().orElseThrow();
        var dim=snapshots(new FusionPlanner.Recipe(r.version(),List.of(binding),r.measures(),r.relations(),r.calculation())).get(anchor);
        var labels=new LinkedHashMap<String,String>();var dimKeys=dimensions.stream().map(d->d.field().column()).toList();
        String labelColumn=List.of("name","名称","label","title").stream().filter(dim.columns()::contains).findFirst().orElse(null);
        for(var row:dim.rows()){var values=dimKeys.stream().map(row::get).toList();if(values.stream().anyMatch(v->v==null||v.isBlank()))continue;String label=labelColumn==null?String.join(" / ",values):row.get(labelColumn);if(label!=null&&!label.isBlank())labels.put(json.writeValueAsString(values),label.substring(0,Math.min(100,label.length())));}
        evidence.put("dimensionName",binding.name());evidence.put("dimensionLabels",labels);
        evidence.put("boundary","先独立汇总各事实表，再按共同维度对齐；保留未匹配分组，不累计维度金额，不跨指标加总，不推断转化率或因果。范围沿各项已发布指标，包含源快照中这些定义允许的历史与状态。");
        String body=json.writeValueAsString(evidence),sha=digest(evidence);if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>40000)throw rejected("FUSION_RESULT_LIMIT");
        UUID artifact=UUID.fromString(json.valueToTree(base).path("artifact").path("id").asText());
        var old=db.queryForList("SELECT evidence_sha256 FROM governed_fusion_receipts WHERE artifact_id=?",String.class,artifact);
        if(!old.isEmpty()&&!old.getFirst().equals(sha))throw rejected("FUSION_RECEIPT_CHANGED");
        db.update("INSERT INTO governed_fusion_receipts(artifact_id,task_id,attempt_number,evidence,evidence_sha256) VALUES(?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING",artifact,job.id(),t.get("attempt"),body,sha);
        var result=new LinkedHashMap<String,Object>(base);result.put("fusion",evidence);result.put("fusionSha256",sha);return result;
    }
    /** Callers must first authorize the card/task. Source fences are checked again here. */
    public JsonNode evidence(UUID task,int attempt,UUID artifact){
        var rows=db.queryForList("SELECT evidence,evidence_sha256 FROM governed_fusion_receipts WHERE task_id=? AND attempt_number=? AND artifact_id=?",task,attempt,artifact);
        if(rows.isEmpty())return null;
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT task_datasets_readable(?) AND NOT EXISTS(SELECT 1 FROM task_dataset_fences WHERE task_id=? AND attempt_number=?)",Boolean.class,task,task,attempt)))throw new IdentityException(403,"FUSION_SOURCE_DENIED");
        var e=tree(rows.getFirst().get("evidence"));if(!digest(e).equals(rows.getFirst().get("evidence_sha256")))throw rejected("FUSION_RECEIPT_CHANGED");return e;
    }
}
