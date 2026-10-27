package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.identity.IdentityException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import tools.jackson.databind.JsonNode;

/** Pure bounded aggregation of already-authorized rows; no model, database or display-name dispatch. */
public final class DatasetEvidenceCalculator {
 private DatasetEvidenceCalculator() {}
 private static final tools.jackson.databind.json.JsonMapper JSON=new tools.jackson.databind.json.JsonMapper();
 public record Plan(String name,String meaning,String unit,String grain,String scope,String evidence,String value,
   List<String> groups,String date,String from,String to,String timeZone,Map<String,String> filters,boolean month,int limit,boolean distinctOnly) {}
 public static List<Plan> declared(JsonNode items) {
  List<Plan> plans=new ArrayList<>();
  for(var item:items){var d=item.path("definition");var e=d.path("execution");var groups=new ArrayList<String>();e.path("groupColumns").forEach(v->groups.add(v.asText()));var filters=new TreeMap<String,String>();e.path("equalsFilters").properties().forEach(v->filters.put(v.getKey(),v.getValue().asText()));
   plans.add(new Plan(d.path("name").asText(),d.path("meaning").asText(),d.path("unit").asText(),d.path("grain").asText(),d.path("scope").asText(),d.path("evidence").asText(),"SUM".equals(d.path("aggregation").asText())?d.path("valueField").asText():"",groups,e.path("dateColumn").asText(),e.path("dateFrom").asText(),e.path("dateTo").asText(),e.path("timeZone").asText(),filters,false,8,false));
  }return List.copyOf(plans);
 }
 private static final class Total {BigDecimal amount=BigDecimal.ZERO;int count,missing;}
 public static List<String> calculate(String source,List<String> columns,JsonNode rows,List<Plan> plans) {
  var facts=new ArrayList<String>();facts.add(source+"：本快照共 "+rows.size()+" 条来源记录；不等于独立客户数、当前有效合同数或实际到账笔数。");
  if(plans.isEmpty())facts.add(source+"：尚无可执行统计计划，本次只提供记录范围，不推算金额或业务状态。");
  for(var p:plans){
   var totals=new TreeMap<String,Total>();int outside=0,ungrouped=0;Set<String> distinct=new HashSet<>();
   for(var row:rows){boolean match=true;for(var f:p.filters().entrySet())if(!cell(row,columns,f.getKey()).equals(f.getValue()))match=false;if(!match){outside++;continue;}
    if(!p.date().isEmpty()) {String date=cell(row,columns,p.date());try {date=date(date,p.timeZone()).toString();}catch(RuntimeException bad){throw new IdentityException(409,"DATASET_INSIGHT_DATE_INVALID");}if(!p.from().isEmpty()&&date.compareTo(p.from())<0||!p.to().isEmpty()&&date.compareTo(p.to())>0){outside++;continue;}}
    var keys=new ArrayList<String>();boolean invalid=false;
    for(String column:p.groups()){String v=cell(row,columns,column);if(p.distinctOnly()){if(!v.isBlank())distinct.add(v);else ungrouped++;invalid=true;break;}if(p.month()){try{v=LocalDate.parse(v).toString().substring(0,7);}catch(RuntimeException bad){invalid=true;break;}}if(v.isBlank()||v.length()>80){invalid=true;break;}keys.add(v);}
    if(p.distinctOnly())continue;if(invalid){ungrouped++;continue;}
    String key=keys.isEmpty()?"全部":JSON.writeValueAsString(keys);var total=totals.computeIfAbsent(key,k->new Total());total.count++;
    if(p.value().isEmpty())total.amount=total.amount.add(BigDecimal.ONE);else{String value=cell(row,columns,p.value());if(value.isBlank()){total.missing++;continue;}if(!com.dreamcore.workspace.governance.DeclaredValueChecks.decimal(value))throw new IdentityException(409,"DATASET_INSIGHT_VALUE_INVALID");total.amount=total.amount.add(new BigDecimal(value));}
   }
   String basis="；口径："+p.meaning()+"；单位："+p.unit()+"；粒度："+p.grain()+"；范围："+p.scope()+(!p.date().isEmpty()?"，"+p.date()+" "+p.from()+" 至 "+p.to():"")+"；依据："+p.evidence();
   if(p.distinctOnly()){facts.add(source+" · "+p.name()+"：不同非空文本 "+distinct.size()+" 种，空白 "+ungrouped+" 条。未提供原文，不能推断完成或关闭状态"+basis);continue;}
   var entries=p.month()?totals.descendingMap().entrySet().stream().limit(p.limit()).toList():totals.entrySet().stream().limit(p.limit()).toList();
   for(var entry:entries){var t=entry.getValue();facts.add(source+" · "+p.name()+" · "+entry.getKey()+"："+t.amount.toPlainString()+" "+p.unit()+"；匹配记录 "+t.count+" 条，未计入空值 "+t.missing+" 条"+basis+"。登记值不代表银行到账、利润或逾期本金；不跨表加总。");}
   facts.add(source+" · "+p.name()+"：共 "+totals.size()+" 组，仅展示"+(p.month()?"来源日期最新":"名称排序前")+p.limit()+"组；范围外 "+outside+" 条，无法分组 "+ungrouped+" 条。"+(p.month()?"可能包含未来账期，不代表已结账月份。":""));
  }return List.copyOf(facts);
 }
 private static LocalDate date(String value,String zone){
  if(value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))return LocalDate.parse(value);
  try{return java.time.OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.of(zone)).toLocalDate();}
  catch(java.time.format.DateTimeParseException noOffset){return java.time.LocalDateTime.parse(value.replace(' ','T')).toLocalDate();}
 }
 private static String cell(JsonNode row,List<String> columns,String column){int i=columns.indexOf(column);if(i<0)throw new IdentityException(409,"DATASET_INSIGHT_PLAN_INVALID");return row.path(i).asText("");}
}
