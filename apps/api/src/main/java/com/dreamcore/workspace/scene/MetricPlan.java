package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.conversation.DatasetCalculationService;
import java.util.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Fixed supported recipe; free-text business exclusions cannot silently become a whole-table sum. */
public final class MetricPlan {
 private static final JsonMapper JSON=new JsonMapper();
 private MetricPlan(){}
 public static JsonNode validate(JsonNode plan,JsonNode meta,String valueField){
  if(plan.isMissingNode()||plan.isNull())return JSON.nullNode();
  if(!plan.isObject())throw IdentityException.invalid();
  var keys=new HashSet<String>();plan.properties().forEach(e->keys.add(e.getKey()));
  if(!keys.equals(Set.of("groupColumns","dateColumn","dateFrom","dateTo","timeZone","reviewed"))||!plan.path("reviewed").isBoolean())throw IdentityException.invalid();
  var columns=new HashSet<String>();for(var f:meta.path("fields"))columns.add(f.path("name").asText());
  var groups=plan.path("groupColumns");if(!groups.isArray()||groups.size()>3)throw IdentityException.invalid();var distinct=new HashSet<String>();
  for(var g:groups)if(!g.isTextual()||!columns.contains(g.asText())||g.asText().equals(valueField)||!distinct.add(g.asText()))throw new IdentityException(422,"METRIC_PLAN_FIELDS_INVALID");
  for(String key:List.of("dateColumn","dateFrom","dateTo","timeZone"))if(!plan.path(key).isTextual()||plan.path(key).asText().length()>160)throw IdentityException.invalid();
  String date=plan.path("dateColumn").asText(),from=plan.path("dateFrom").asText(),to=plan.path("dateTo").asText();
  if(date.isEmpty()!= (from.isEmpty()&&to.isEmpty())||!date.isEmpty()&&!columns.contains(date))throw new IdentityException(422,"METRIC_PLAN_FIELDS_INVALID");
  try{java.time.ZoneId.of(plan.path("timeZone").asText());for(String d:List.of(from,to))if(!d.isEmpty()&&(!d.matches("\\d{4}-\\d{2}-\\d{2}")||!java.time.LocalDate.parse(d).toString().equals(d)))throw new IllegalArgumentException();if(!from.isEmpty()&&!to.isEmpty()&&from.compareTo(to)>0)throw new IllegalArgumentException();}catch(RuntimeException e){throw new IdentityException(422,"METRIC_PLAN_FIELDS_INVALID");}
  return plan.deepCopy();
 }
 public static boolean ready(JsonNode definition){return definition.path("execution").path("reviewed").asBoolean()&&"无".equals(definition.path("exclusions").asText());}
 public static DatasetCalculationService.Request request(JsonNode d,UUID dataset,UUID snapshot,UUID metric,int version){
  var p=d.path("execution");List<String> groups=new ArrayList<>();p.path("groupColumns").forEach(g->groups.add(g.asText()));
  String date=p.path("dateColumn").asText();return new DatasetCalculationService.Request(dataset,snapshot,null,null,"SUM".equals(d.path("aggregation").asText())?d.path("valueField").asText():null,null,null,null,p.path("timeZone").asText("Asia/Shanghai"),d.path("aggregation").asText(),"SUMMARY",groups,date.isEmpty()?null:date,p.path("dateFrom").asText().isEmpty()?null:p.path("dateFrom").asText(),p.path("dateTo").asText().isEmpty()?null:p.path("dateTo").asText(),date.isEmpty()?null:"FAIL",metric,version);
 }
 public static boolean matches(DatasetCalculationService.Request actual,DatasetCalculationService.Request expected){
  var a=(tools.jackson.databind.node.ObjectNode)JSON.valueToTree(actual);var b=(tools.jackson.databind.node.ObjectNode)JSON.valueToTree(expected);
  // Documented defaults are equivalent; no business fields or filters are repaired.
  if(actual.timeZone()==null)a.put("timeZone","Asia/Shanghai");
  if(actual.dateColumn()!=null&&actual.missingDates()==null)a.put("missingDates","FAIL");
  return a.equals(b);
 }
}
