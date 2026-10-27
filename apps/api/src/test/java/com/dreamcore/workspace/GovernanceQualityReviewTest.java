package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class GovernanceQualityReviewTest {
 final GovernanceModelService service=new GovernanceModelService(null,null,null,null,null,null);
 Map<String,Object> context(){return Map.of("kind","DATASET","checks",Map.of("state","CHECKED","exportValidation",Map.of("state","CHECKED")),"sourceEvidence",List.of(Map.of("column","编号","sourceMetadata",Map.of("definition","编号为合成来源的唯一业务标识字段。"))));}
 Map<String,Object> output(){return Map.of("fields",List.of(Map.of("decision","KEEP_SOURCE")),"qualityReview",Map.of("state","USABLE","summary","语义与已声明检查一致，保留未声明业务限制。","citations",List.of(Map.of("locator","编号","quote","编号为合成来源的唯一业务标识字段。"))));}
 @Test void currentReviewRequiresRealCitationAndCannotOverrideHardFailure(){
  service.validateQualityReview(output(),context());
  var bad=new LinkedHashMap<String,Object>(context());bad.put("checks",Map.of("state","CHECKED","duplicatePrimaryKeys",1,"exportValidation",Map.of("state","CHECKED")));
  assertThrows(IdentityException.class,()->service.validateQualityReview(output(),bad));
  var fake=new LinkedHashMap<String,Object>(output());fake.put("qualityReview",Map.of("state","USABLE","summary","伪造依据","citations",List.of(Map.of("locator","编号","quote","这句话不在来源定义的原文之中。"))));
  assertThrows(IdentityException.class,()->service.validateQualityReview(fake,context()));
  assertThrows(IdentityException.class,()->service.validateQualityReview(Map.of(),context()));
 }
 @Test void partialParseAndUnknownFieldsCannotBeUsable(){
  var out=new LinkedHashMap<String,Object>(output());out.put("fields",List.of(Map.of("decision","UNKNOWN")));
  assertThrows(IdentityException.class,()->service.validateQualityReview(out,context()));
  var material=Map.<String,Object>of("kind","MATERIAL","parserStatus","PARTIAL","fragments",List.of(Map.of("id","part","content","编号为合成来源的唯一业务标识字段。")));
  assertThrows(IdentityException.class,()->service.validateQualityReview(output(),material));
 }
}
