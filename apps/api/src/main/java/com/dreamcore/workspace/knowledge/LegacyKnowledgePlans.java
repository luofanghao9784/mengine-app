package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.collection.DatasetField;
import java.util.*;

/** Explicit v1 compatibility recipes only. New sources declare analysis-plan; never infer additive measures. */
final class LegacyKnowledgePlans {
 static List<DatasetEvidenceCalculator.Plan> forSource(String name,List<String> columns,List<DatasetField> fields){
  var plans=new ArrayList<DatasetEvidenceCalculator.Plan>();
  for(String dimension:List.of("店面","收付状态","收付标记","合同状态（原始码）","业务类型","客户状态"))if(columns.contains(dimension))plans.add(plan("来源类别记录数", "原始类别记录数量，没有业务映射不得解释为有效、成功或逾期", "条", "",List.of(dimension),false,false));
  if(columns.contains("进展"))plans.add(plan("进展文本覆盖", "只统计不同文本数量，不读取内容", "种", "",List.of("进展"),false,true));
  // This documented migration is intentionally narrow; matching column names on unrelated tables is insufficient.
  if(name.equals("财务-流水账"))for(String column:List.of("实收金额","实付金额","逾期费用")){
   var field=fields.stream().filter(f->f.column().equals(column)&&f.type().equals("decimal")&&!f.unit().isBlank()).findFirst();if(field.isEmpty()||!columns.contains(column))continue;
   plans.add(plan(column+"登记合计","完整快照历史登记值求和",field.get().unit(),column,List.of(),false,false));
   if(columns.contains("店面"))plans.add(plan(column+"按店面登记合计","按来源店面文字分组，不证明跨表实体相同",field.get().unit(),column,List.of("店面"),false,false));
   if(columns.contains("应收付日"))plans.add(plan(column+"按账期登记合计","按应收付日期月份归属，不是实际现金收付月份",field.get().unit(),column,List.of("应收付日"),true,false));
  }return List.copyOf(plans);
 }
 private static DatasetEvidenceCalculator.Plan plan(String name,String meaning,String unit,String value,List<String> groups,boolean month,boolean distinct){return new DatasetEvidenceCalculator.Plan(name,meaning,unit,"来源记录","当前完整快照","legacy-knowledge-v1：原有已发布字段口径",value,groups,"","","","Asia/Shanghai",Map.of(),month,month?3:8,distinct);}
}
