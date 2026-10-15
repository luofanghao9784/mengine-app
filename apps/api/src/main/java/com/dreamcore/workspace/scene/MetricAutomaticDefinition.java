package com.dreamcore.workspace.scene;
import java.util.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
/** User-delegated technical definitions, not an assertion of verified business outcomes. */
public final class MetricAutomaticDefinition {
 private static final JsonMapper JSON=new JsonMapper();
 private MetricAutomaticDefinition(){}
 public record Decision(Map<String,Object> definition,String reason){}
 public static Decision decide(JsonNode old,JsonNode meta,JsonNode columns,JsonNode rows){
  String aggregation=old.path("aggregation").asText(),field=old.path("valueField").asText();
  boolean count=aggregation.equals("COUNT");String reason=null;
  if(!count&&!aggregation.equals("SUM"))reason="UNSUPPORTED_RECIPE";
  if(!count)for(var n:meta.path("analysisPolicy").path("noSumFields"))if(n.asText().equals(field))reason="SOURCE_FORBIDS_SUM";
  for(var n:meta.path("analysisPolicy").path("excludeFields"))if(!count&&n.asText().equals(field))reason="FIELD_EXCLUDED";
  int index=-1;for(int i=0;i<columns.size();i++)if(columns.get(i).asText().equals(field))index=i;
  if(!count&&index<0)reason="FIELD_UNAVAILABLE";
  if(reason==null&&(!rows.isArray()||rows.size()==0))reason="EMPTY_SNAPSHOT";
  if(reason==null&&rows.size()>100000)reason="SNAPSHOT_LIMIT";
  if(reason==null)for(var row:rows){
   if(!row.isArray()||row.size()!=columns.size()){reason="INVALID_SNAPSHOT";break;}
   if(!count){var n=row.get(index);if(!n.isTextual()&&!n.isNumber()||!n.asText().matches("-?\\d{1,18}(\\.\\d{1,12})?")){reason="INVALID_NUMERIC_VALUES";break;}}
  }
  String title=meta.path("title").asText("来源数据"),label=field,evidence="源表结构与固定快照记录计数";
  if(!count){
   JsonNode sem=JSON.createObjectNode();for(var f:meta.path("dictionary").path("fields"))if(f.path("name").asText().equals(field))sem=f;
   label=sem.path("label").asText(field);evidence=sem.path("evidence").asText();
   if(reason==null&&(evidence.isBlank()||evidence.contains("INFERRED")||old.path("unit").asText().isBlank()))reason="EVIDENCE_INCOMPLETE";
  }
  var d=new LinkedHashMap<String,Object>();
  d.put("name",clip(title+" · "+(count?"快照记录数":label+"原始登记值合计"),100));
  d.put("meaning",count?"统计固定快照中实际记录的条数，不去重，不等于有效门店数、人数或订单数。":"对字段 "+field+" 的快照全部登记值按源单位求和，包含源中现存各状态；仅表示原始登记值统计，不等于有效收款、经营收入、实际退款或净额。");
  d.put("unit",count?"条":old.path("unit").asText());d.put("grain","一行源记录；按快照逐行计算，不按人员、订单等对象去重");
  d.put("scope","当前获权固定快照全部记录及源中现存历史；包含失效、取消等现存状态，不证明源系统业务完整性");d.put("exclusions","无");
  d.put("evidence",clip("用户委托自动定义；依据："+evidence+"。"+(reason==null?"通过结构、源策略与当前快照可执行性检查；不声称人工核实业务事实。":"暂不发布："+reasonText(reason)),400));
  d.put("aggregation",aggregation);d.put("valueField",field);d.put("execution",Map.of("groupColumns",List.of(),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",reason==null));
  return new Decision(d,reason);
 }
 private static String clip(String s,int n){return s.substring(0,Math.min(s.length(),n));}
 public static String reasonText(String reason){return switch(reason){case "SOURCE_FORBIDS_SUM"->"来源治理规则禁止直接求和，需要支持相应业务计算后才能执行";case "EMPTY_SNAPSHOT"->"当前快照没有记录，等待可计算数据";case "INVALID_NUMERIC_VALUES"->"存在缺失或无效数值，先治理来源数据";case "EVIDENCE_INCOMPLETE"->"字段单位或依据仍不完整，等待来源治理补齐";case "FIELD_EXCLUDED","FIELD_UNAVAILABLE"->"字段被排除或已不可用";default->"当前来源超出支持的计算范围";};}
}
