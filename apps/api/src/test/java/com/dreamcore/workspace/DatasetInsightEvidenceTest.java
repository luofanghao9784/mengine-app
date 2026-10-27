package com.dreamcore.workspace;
import com.dreamcore.workspace.knowledge.DatasetBusinessKnowledgeService;
import com.dreamcore.workspace.identity.IdentityException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;
class DatasetInsightEvidenceTest {
 final DatasetBusinessKnowledgeService service=new DatasetBusinessKnowledgeService();
 final JsonMapper json=new JsonMapper();
 final UUID dataset=UUID.randomUUID();
 final DatasetBusinessKnowledgeService.Context context=new DatasetBusinessKnowledgeService.Context(
  List.of(new DatasetBusinessKnowledgeService.Source(dataset,UUID.randomUUID(),UUID.randomUUID(),"合成账单")),
  List.of(new DatasetBusinessKnowledgeService.Fact("F1",dataset,"实收登记金额 100 元，实付登记金额 20 元。不是银行到账或利润。")),"仅合成数据");
 Map<String,Object> finding(){return new LinkedHashMap<>(Map.of("title","登记范围","interpretation","可能需要核对账期","action","核对原始凭据","factIds",List.of("F1")));}
 String report(Map<String,Object> f){return json.writeValueAsString(Map.of("title","合成观察","findings",List.of(f),"limitations","不是利润"));}
 @Test void modelCannotSupplyOrRewriteAnyFactualObservation(){
  for(String wrong:List.of("实收登记金额 20 元，实付登记金额 100 元","实收登记金额 100 万元","实收登记金额 -100 元","实际利润 100 元","实收登记金额一百万元")){
   var f=finding();f.put("observation",wrong);assertThrows(IdentityException.class,()->service.validate(report(f),context),wrong);
  }
 }
 @Test void factualReferencesNeedNoModelWrittenObservation(){assertEquals(List.of("F1"),service.validate(report(finding()),context).findings().getFirst().factIds());}
 @Test void fabricatedFactIdRemainsRejected(){var f=finding();f.put("factIds",List.of("F999"));assertThrows(IdentityException.class,()->service.validate(report(f),context));}
}
