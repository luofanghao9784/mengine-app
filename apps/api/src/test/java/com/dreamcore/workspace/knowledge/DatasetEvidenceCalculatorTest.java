package com.dreamcore.workspace.knowledge;
import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.context.NativeAnalysisPlans;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class DatasetEvidenceCalculatorTest {
 final JsonMapper json=new JsonMapper();
 DatasetEvidenceCalculator.Plan plan(String from,String to){return new DatasetEvidenceCalculator.Plan("登记求和","按来源原值","件","单笔记录","指定范围","合成已核实口径","数量",List.of("门店"),from.isEmpty()?"":"日期",from,to,"Asia/Shanghai",Map.of("方向","收"),false,8,false);}
 @Test void exactSumsKeepFiltersNullsAndPeriod(){
  var facts=DatasetEvidenceCalculator.calculate("任意新名称",List.of("门店","数量","日期","方向"),json.readTree("[[\"甲\",\"0.1\",\"2026-10-01\",\"收\"],[\"甲\",\"0.2\",\"2026-10-02\",\"收\"],[\"甲\",null,\"2026-10-03\",\"收\"],[\"甲\",\"100\",\"2026-09-01\",\"收\"],[\"甲\",\"100\",\"2026-10-01\",\"付\"]]"),List.of(plan("2026-10-01","2026-10-31")));
  assertTrue(facts.stream().anyMatch(f->f.contains("0.3 件")&&f.contains("未计入空值 1")));
  assertTrue(facts.stream().anyMatch(f->f.contains("范围外 2")));
 }
 @Test void invalidValuesAndDatesNeverBecomeZero(){
  for(String row:List.of("[[\"甲\",\"bad\",\"2026-10-01\",\"收\"]]","[[\"甲\",\"1\",\"bad\",\"收\"]]"))assertThrows(RuntimeException.class,()->DatasetEvidenceCalculator.calculate("表",List.of("门店","数量","日期","方向"),json.readTree(row),List.of(plan("2026-10-01","2026-10-31"))));
 }
 @Test void offsetDatesUseDeclaredTimeZone(){
  var facts=DatasetEvidenceCalculator.calculate("表",List.of("门店","数量","日期","方向"),json.readTree("[[\"甲\",\"5\",\"2026-09-30T18:00:00Z\",\"收\"]]"),List.of(plan("2026-10-01","2026-10-31")));
  assertTrue(facts.stream().anyMatch(f->f.contains("5 件")));
 }
 @Test void groupKeysCannotCollideWhenLabelsContainDelimiters(){
  var p=new DatasetEvidenceCalculator.Plan("计数","来源行","条","行","全量","合成","",List.of("一","二"),"","","","Asia/Shanghai",Map.of(),false,8,false);
  var facts=DatasetEvidenceCalculator.calculate("表",List.of("一","二"),json.readTree("[[\"a, b\",\"c\"],[\"a\",\"b, c\"]]"),List.of(p));
  assertTrue(facts.stream().anyMatch(f->f.contains("共 2 组")));
 }
 @Test void missingPlanDoesNotInferFinance(){
  var facts=DatasetEvidenceCalculator.calculate("任意表",List.of("实收金额"),json.readTree("[[\"900\"]]"),List.of());assertTrue(facts.stream().anyMatch(f->f.contains("尚无可执行统计计划")));assertFalse(facts.toString().contains("900"));
 }
 @Test void declaredUnitMismatchCannotExecute(){
  var execution=Map.of("groupColumns",List.of(),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true);
  var d=new HashMap<String,Object>(Map.of("name","合计","meaning","来源登记","unit","万元","grain","来源行","scope","全量","evidence","合成口径","aggregation","SUM","valueField","金额","exclusions","无"));d.put("execution",execution);
  assertThrows(RuntimeException.class,()->NativeAnalysisPlans.fromSchema(List.of(Map.of("kind","analysis-plan","definition",d)),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),List.of("金额"),List.of(new DatasetField("金额","decimal","来源登记","元","合成","SOURCE_DOCUMENTED")),java.time.Instant.now()));
 }
}
