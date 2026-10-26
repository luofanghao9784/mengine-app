package com.dreamcore.workspace.context;

import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.governance.GovernanceSourceEvidence;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.scene.MetricPlan;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;

/** Deployment-reviewed source summaries; no new calculation or content authority. */
public final class NativeAnalysisPlans {
    private static final JsonMapper JSON=new JsonMapper();
    private NativeAnalysisPlans() {}
    public static Map<String,Object> load(String path,UUID tenant,UUID dataset,UUID snapshot,String name,List<String> columns,List<DatasetField> fields) {
        var records=GovernanceSourceEvidence.read(path,tenant,dataset,name,"schema",false).stream()
            .filter(r->"analysis-plan".equals(r.get("kind"))).toList();
        if(records.size()>8)throw new IdentityException(503,"NATIVE_ANALYSIS_PLANS_INVALID");
        var metadata=JSON.createObjectNode();var fs=metadata.putArray("fields");
        fields.forEach(f->fs.addObject().put("name",f.column()).put("type",Set.of("decimal","numeric","number","integer").contains(f.type().toLowerCase(Locale.ROOT))?"number":"text"));
        var items=new ArrayList<Object>();
        for(var r:records) {
            try {
                var d=JSON.valueToTree(r.get("definition"));
                if(!d.isObject()||!Set.of("COUNT","SUM").contains(d.path("aggregation").asText())||!"无".equals(d.path("exclusions").asText()))throw new IllegalArgumentException();
                for(String key:List.of("name","meaning","unit","grain","scope","evidence"))
                    if(!d.path(key).isTextual()||d.path(key).asText().isBlank()||d.path(key).asText().length()>400)throw new IllegalArgumentException();
                String value=d.path("valueField").asText();boolean sum="SUM".equals(d.path("aggregation").asText());
                if(!sum&&!value.isEmpty())throw new IllegalArgumentException();
                var plan=MetricPlan.validate(d.path("execution"),metadata,value);
                if(!plan.path("reviewed").asBoolean()||!Set.of("NONE","").contains(plan.path("conversion").asText()))throw new IllegalArgumentException();
                var used=new HashSet<String>();plan.path("groupColumns").forEach(c->used.add(c.asText()));
                if(sum)used.add(value);if(!plan.path("dateColumn").asText().isEmpty())used.add(plan.path("dateColumn").asText());
                plan.path("equalsFilters").properties().forEach(e->used.add(e.getKey()));
                for(String column:used)if(!columns.contains(column)||fields.stream().noneMatch(f->f.column().equals(column)&&"SOURCE_DOCUMENTED".equals(f.status())))throw new IllegalArgumentException();
                if(sum&&fields.stream().noneMatch(f->f.column().equals(value)&&Set.of("decimal","numeric","number","integer").contains(f.type().toLowerCase(Locale.ROOT))&&f.unit().equals(d.path("unit").asText())))throw new IllegalArgumentException();
                var definition=(tools.jackson.databind.node.ObjectNode)d.deepCopy();definition.set("execution",plan);
                var req=MetricPlan.request(definition,dataset,snapshot,null,1);
                var execution=(tools.jackson.databind.node.ObjectNode)JSON.valueToTree(req);execution.remove("metricId");execution.remove("metricVersion");
                // Omitted nulls are documented calculator defaults, never repaired business predicates.
                for(String key:new ArrayList<>(execution.propertyNames()))if(execution.path(key).isNull())execution.remove(key);
                String method=UUID.nameUUIDFromBytes(("native-source-method:"+tenant+":"+dataset+":"+IdentityService.hash(definition.toString())).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
                var selection=Map.of("metricId",method,"metricVersion",1,"datasetId",dataset.toString(),"snapshotId",snapshot.toString());
                items.add(Map.of("methodId",method,"version",1,"selection",selection,"definition",definition,"executionRequest",execution,"authority",false));
            } catch(RuntimeException invalid) {throw new IdentityException(503,"NATIVE_ANALYSIS_PLANS_INVALID");}
        }
        return Map.of("items",items,"usage","部署已核对的原生来源固定统计方法，只把 selection 四项交给 compare_dataset，执行器展开对应的固定 executionRequest；selection 是原生方法选择标识，不是旧版指标或额外授权，不套用旧版门店销售方法。保留原值、来源范围和收付方向；登记金额不代表到账、营业额或利润。计算仍须当前任务授权、固定快照及成功回执。","authority",false);
    }
}
