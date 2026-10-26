package com.dreamcore.workspace.analysis.governed;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import tools.jackson.databind.json.JsonMapper;
class FusionNarrativeEvidenceTest {
 private final tools.jackson.databind.JsonNode evidence=new JsonMapper().readTree("""
 {"results":[{"label":"9POP收款额","total":"120000","baseRecords":4,"includedRecords":4,"groups":[{"value":"120000","records":4}],"unmatched":{"s2":0}}],"sources":[{"name":"9POP源表","rowCount":4}],"dimensionLabels":{"s1":"1号店"}}
 """);
 @Test void exactAndExactScaledValuesAccepted(){assertDoesNotThrow(()->FusionNarrativeEvidence.validate("9POP收款额为120,000，1号店共4条记录。精确换算为12万。",evidence));}
 @Test void InventedOrRoundedValuesRejected(){assertThrows(RuntimeException.class,()->FusionNarrativeEvidence.validate("收款为12.1万。",evidence));assertThrows(RuntimeException.class,()->FusionNarrativeEvidence.validate("新增999笔。",evidence));}
 @Test void publishedFactsBindEachMetricToItsOwnValueEvenWhenSwappedNumbersWereBothPresent(){
  var proof=new JsonMapper().readTree("""
  {"results":[{"label":"订单登记金额","unit":"元","total":"100","baseRecords":3,"includedRecords":3,"groups":[{"value":"100","records":3}]},{"label":"收款登记金额","unit":"元","total":"20","baseRecords":2,"includedRecords":2,"groups":[{"value":"20","records":2}]}],"dimensionName":"门店"}
  """);
  var request=new com.dreamcore.workspace.conversation.BriefingContentService.Request(java.util.UUID.randomUUID(),"订单20元、收款100元","订单登记金额为20元，收款登记金额为100元。",java.util.List.of("订单登记金额只有20元，收款登记金额已经100元。","建议继续核对原始订单和收款凭据。"));
  var rendered=FusionNarrativeEvidence.render(request,proof);assertTrue(rendered.summary().contains("「订单登记金额」合计 100 元"));assertTrue(rendered.summary().contains("「收款登记金额」合计 20 元"));assertFalse(String.join("",rendered.analysis()).contains("订单登记金额只有20元"));assertEquals(rendered,FusionNarrativeEvidence.render(request,proof));
 }
}
