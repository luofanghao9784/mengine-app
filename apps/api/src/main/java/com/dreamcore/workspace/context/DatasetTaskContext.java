package com.dreamcore.workspace.context;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Called only inside the live task callback transaction. Scope and actor come from the task. */
@Service
public class DatasetTaskContext {
    private final JdbcTemplate db; private final MaterialAccess access; private final com.dreamcore.workspace.collection.NativeGovernanceDeployment governance; private final JsonMapper json=new JsonMapper();
    public DatasetTaskContext(JdbcTemplate db,MaterialAccess access,com.dreamcore.workspace.collection.NativeGovernanceDeployment governance){this.db=db;this.access=access;this.governance=governance;}
    private Map<String,Object> map(Object... values){var m=new LinkedHashMap<String,Object>();for(int i=0;i<values.length;i+=2)m.put((String)values[i],values[i+1]);return m;}
    @org.springframework.beans.factory.annotation.Value("${dreamcore.governance.source-evidence:}") private String evidencePath="";
    private IdentityException missing(){return new IdentityException(404,"TASK_DATASET_NOT_FOUND");}
    private Map<String,Object> task(UUID id){return db.queryForMap("SELECT * FROM conversation_tasks WHERE id=?",id);}
    private List<Map<String,Object>> rows(Map<String,Object> t,UUID dataset,UUID snapshot,String q,int offset,int limit){
        return db.queryForList("""
          SELECT d.id,d.workspace_id,d.name,d.description,d.column_names,d.field_definitions,d.current_snapshot,s.id snapshot_id,s.version,s.row_count,s.coverage_through,s.collected_at
          FROM business_datasets d JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=?
          LEFT JOIN task_dataset_reads pin ON pin.task_id=? AND pin.attempt_number=? AND pin.dataset_id=d.id
          JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=coalesce(pin.snapshot_id,
            (SELECT pick.snapshot_id FROM briefing_dataset_selections pick WHERE pick.task_id=? AND pick.dataset_id=d.id AND NOT pick.invalidated),d.current_snapshot)
          WHERE d.tenant_id=? AND d.status='ACTIVE' AND file_dataset_readable(g.account_id,d.id) AND (library_mask(g.account_id,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1 AND NOT d.scrubbed AND NOT s.scrubbed
           AND (?<>'SELECTED' OR EXISTS(SELECT 1 FROM briefing_dataset_selections pick WHERE pick.task_id=? AND pick.dataset_id=d.id AND pick.snapshot_id=s.id AND NOT pick.invalidated))
           AND (? IN ('AUTHORIZED_LIBRARY','SELECTED') OR d.workspace_id=?::uuid) AND departure_content_readable(?,d.tenant_id,d.workspace_id)
           AND (?::uuid IS NULL OR d.id=?::uuid) AND (?::uuid IS NULL OR s.id=?::uuid)
           AND (?='' OR strpos(lower(d.name||' '||d.description),lower(?))>0 OR EXISTS(SELECT 1 FROM scene_metrics m JOIN scene_metric_versions mv ON mv.metric_id=m.id AND mv.version=m.published_version JOIN scene_asset_links ml ON ml.tenant_id=m.tenant_id AND ml.source_id=m.source_id AND ml.kind='TABLE' AND ml.active WHERE ml.target_id=d.id AND m.tenant_id=d.tenant_id AND scene_table_scope(ml.metadata)=mv.source_scope AND strpos(lower(mv.definition->>'name'),lower(?))>0))
          ORDER BY d.name,d.id LIMIT ? OFFSET ?
          """,t.get("requested_by"),t.get("id"),t.get("attempt"),t.get("id"),t.get("tenant_id"),t.get("source_scope"),t.get("id"),t.get("source_scope"),t.get("workspace_id"),t.get("requested_by"),dataset,dataset,snapshot,snapshot,q,q,q,limit,offset);
    }
    private void pin(Map<String,Object> t,Map<String,Object> d){
        access.require((UUID)t.get("requested_by"),(UUID)t.get("tenant_id"),(UUID)d.get("workspace_id"),false);
        // The task row lock serializes simultaneous callbacks before the first snapshot is pinned.
        if(db.queryForObject("SELECT count(*) FROM task_dataset_reads WHERE task_id=? AND attempt_number=?",Integer.class,t.get("id"),t.get("attempt"))>=32 &&
           db.queryForObject("SELECT count(*) FROM task_dataset_reads WHERE task_id=? AND attempt_number=? AND dataset_id=?",Integer.class,t.get("id"),t.get("attempt"),d.get("id"))==0)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
        db.update("INSERT INTO task_dataset_reads(task_id,attempt_number,dataset_id,snapshot_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",t.get("id"),t.get("attempt"),d.get("id"),d.get("snapshot_id"));
    }
    private Object time(Object v){return v==null?null:((Timestamp)v).toInstant();}
    private Map<String,Object> metadata(Map<String,Object> t,Map<String,Object> d,int columnOffset,int columnLimit,String query){
        UUID task=(UUID)t.get("id");
        List<String> columns=json.readValue(d.get("column_names").toString(),json.getTypeFactory().constructCollectionType(List.class,String.class));
        if(columnOffset>=columns.size())throw IdentityException.invalid();int end=Math.min(columns.size(),columnOffset+columnLimit);
        List<String> visible=columns.subList(columnOffset,end);
        var context=map("datasetId",d.get("id"),"snapshotId",d.get("snapshot_id"),"version",d.get("version"),"name",d.get("name"),"description",d.get("description"),"columns",visible,"fieldDefinitions",com.dreamcore.workspace.collection.DatasetField.read(d.get("field_definitions")).stream().filter(f->visible.contains(f.column())).toList(),"calculationCapabilities",Map.of("operations",List.of("COMPARE","SUMMARY","COMPOSITION"),"aggregations",List.of("SUM","COUNT"),"crossDatasetJoin",false,"derivedExpressions",false,"maxGroups",50,"summaryGroupColumns",List.of(0,1,2,3),"compositionGroupColumns",1,"requiresPinnedSnapshot",true),"definitionOrigin","DEPLOYMENT","columnOffset",columnOffset,"nextColumnOffset",end<columns.size()?end:null,"totalColumns",columns.size(),"rowCount",d.get("row_count"),"coverageThrough",time(d.get("coverage_through")),"collectedAt",time(d.get("collected_at")),"authority",false,"governedMetrics",com.dreamcore.workspace.scene.MetricCatalog.context(db,task,(UUID)d.get("id"),query),"sourceSemantics",sourceSemantics((UUID)d.get("id")),"businessReading",columns.contains("收款状态")&&columns.contains("收款类型")?Map.of("statusLabels",Map.of("finance_confirmed","财务已确认（不能据此认定到账）","canceled","已取消（不能据此认定已退款）"),"typeLabels",Map.of("deposit","定金"),"money","列名明确标注（分）的金额，展示给读者时换算为元；保留原数值用于计算。","scope","样本仅支持样本观察，原始状态含义未知时说明尚待核实，不推断定金比例。", "dateComparison","可用 compare_dataset 的 periodMode=MONTH 将日期按业务时区归月，月份必须为 YYYY-MM；缺失或格式不明的日期会拒绝计算。") : Map.of());
        // Conversations and briefings use the same current, authorized governance wording.
        UUID release = null;
        if (Objects.equals(d.get("snapshot_id"), d.get("current_snapshot"))) {
            var published = governance.currentFor((UUID)t.get("requested_by"), (UUID)t.get("tenant_id"), (UUID)d.get("id"));
            if (!published.isEmpty()) {
                var current = published.getFirst(); release = current.releaseId();
                context.put("fieldDefinitions", current.fields().stream().filter(f -> visible.contains(f.column())).toList());
                context.put("definitionOrigin", "PUBLISHED_GOVERNANCE");
                var units = new LinkedHashMap<String,String>();
                current.fields().stream().filter(f -> columns.contains(f.column()) && "SOURCE_DOCUMENTED".equals(f.status()) && !f.unit().isBlank())
                    .limit(40).forEach(f -> units.put(f.column(), f.unit()));
                context.put("publishedFieldUnits", units);
                boolean legacy=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE tenant_id=? AND target_id=? AND kind='TABLE')",Boolean.class,t.get("tenant_id"),d.get("id")));
                if (!legacy) {
                    var plans=NativeAnalysisPlans.load(evidencePath,(UUID)t.get("tenant_id"),(UUID)d.get("id"),(UUID)d.get("snapshot_id"),d.get("name").toString(),columns,current.fields());
                    context.put("nativeAnalysisPlans",plans);
                    context.put("governedMetrics",Map.of("items",List.of(),"hasMore",false,"usage","这是原生来源，不使用旧版指标目录；优先执行 nativeAnalysisPlans 中的部署固定方法。没有适用计划时仅可用已发布字段口径和已提供计算能力做有界源值核验，不推定营业额、到账或利润。","automaticExecution",false));
                }
            }
        }
        context.put("governedFields",GovernedFieldContext.loadCurrent(db,(UUID)t.get("tenant_id"),(UUID)t.get("requested_by"),(UUID)d.get("id"),visible,release));
        return context;
    }
    private Object sourceSemantics(UUID dataset){
        var file=db.queryForList("SELECT v.number,v.sha256,v.created_at,f.checked_at FROM file_table_sources f JOIN material_versions v ON v.id=f.version_id WHERE f.dataset_id=?",dataset);
        if(!file.isEmpty()){var f=file.getFirst();return map("kind","FILE_UPLOAD","originalVersion",f.get("number"),"sha256",f.get("sha256"),"uploadedAt",time(f.get("created_at")),"verifiedAt",time(f.get("checked_at")),"freshness","FILE_VERSION_ONLY","businessMeaningConfirmed",false,"usageRules","仅代表上传文件版本；原文件列和值已完整校验，主键、必填、单位和业务统计口径不能自行推断；不是实时源库。");}
        var rows=db.queryForList("SELECT metadata FROM scene_asset_revisions WHERE target_id=? AND kind='TABLE' ORDER BY created_at DESC LIMIT 1",String.class,dataset);
        return rows.isEmpty()?Map.of():json.readTree(rows.getFirst());
    }
    public Object read(UUID task,TaskContextService.Request r){
        db.queryForList("SELECT id FROM conversation_tasks WHERE id=? FOR UPDATE",task);var t=task(task);
        if("SELECTED".equals(t.get("source_scope")) && db.queryForObject("SELECT count(*) FROM briefing_dataset_selections WHERE task_id=? AND NOT invalidated",Integer.class,task)==0)return r.action().equals("dataset_search")?map("items",List.of(),"hasMore",false,"reason","SELECTED_ONLY"):map("unavailable",true,"reason","SELECTED_ONLY");
        int offset=r.offset()==null?0:r.offset();if(offset<0||offset>100000)throw IdentityException.invalid();
        if(r.action().equals("dataset_search")){
            String query=r.query()==null?"":r.query().strip();if(query.length()>200)throw IdentityException.invalid();
            var found=rows(t,null,null,query,offset,4);var out=new ArrayList<Object>();
            for(var d:found.stream().limit(3).toList()){pin(t,d);out.add(metadata(t,d,0,5,query));}
            return map("items",out,"hasMore",found.size()>3,"scope",t.get("source_scope"));
        }
        if(r.referenceId()==null||r.versionId()==null)throw IdentityException.invalid();
        var found=rows(t,r.referenceId(),r.versionId(),"",0,1);if(found.isEmpty())throw missing();var d=found.getFirst();pin(t,d);
        var data=db.queryForList("SELECT item::text FROM dataset_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.data_rows) WITH ORDINALITY AS r(item,position) WHERE s.id=? ORDER BY position LIMIT 6 OFFSET ?",String.class,d.get("snapshot_id"),offset);
        int columnOffset=r.columnOffset()==null?0:r.columnOffset(),columnLimit=r.columnLimit()==null?5:r.columnLimit();
        if(columnOffset<0||columnOffset>99||columnLimit<1||columnLimit>10)throw IdentityException.invalid();
        var source=metadata(t,d,columnOffset,columnLimit,"");var page=new ArrayList<Object>();int bytes=json.writeValueAsBytes(source).length;
        for(String row:data.stream().limit(5).toList()){
            var original=json.readTree(row);var value=new ArrayList<Object>();
            for(int c=columnOffset;c<Math.min(original.size(),columnOffset+columnLimit);c++)value.add(original.get(c).isNull()?null:original.get(c).asString());
            int size=json.writeValueAsBytes(value).length;
            if(bytes+size>48000){if(page.isEmpty())throw new IdentityException(413,"TASK_DATASET_ROW_LIMIT");break;}
            page.add(value);bytes+=size;
        }
        boolean more=data.size()>page.size();return map("source",source,"rows",page,"offset",offset,"nextOffset",more?offset+page.size():null,"hasMore",more,"completeDataset",offset==0&&!more&&columnOffset==0&&source.get("nextColumnOffset")==null,"referenceOnly",true);
    }
    public void inherit(UUID task,UUID source){
        if(task.equals(source))return;
        db.update("INSERT INTO dataset_task_inheritance(task_id,source_task_id) SELECT t.id,s.id FROM conversation_tasks t JOIN conversation_tasks s ON s.tenant_id=t.tenant_id AND s.requested_by=t.requested_by WHERE t.id=? AND s.id=? ON CONFLICT DO NOTHING",task,source);
    }
}
