package com.dreamcore.workspace;
import com.dreamcore.workspace.collection.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class SourceBusinessPreflightTest {
    final List<String> columns=List.of("编号");
    CollectionAdapter.Snapshot snapshot(List<Map<String,Object>> entries,List<Map<String,Object>> rules,List<List<String>> rows) {
        var body=new JsonMapper().writeValueAsString(Map.of("entries",entries,"schema",rules));
        return new CollectionAdapter.Snapshot(UUID.randomUUID(),null,rows,null,new CollectionAdapter.SourceContract("1.0",UUID.randomUUID(),UUID.randomUUID(),1,"unused",body));
    }
    List<Map<String,Object>> entries(){return List.of(Map.of("column","编号","declaredUnit","","definitionScope","BUSINESS_DEFINITION","sourceMetadata",Map.of("definition","已确认业务编号"),"proof",List.of(Map.of("snippet","合成已确认定义"))));}
    List<Map<String,Object>> rules(){return List.of(Map.of("kind","value-rule","id","id","column","编号","type","ENUM","values",List.of("001","002"),"nullable",false,"evidence","合成来源枚举"));}
    @Test void onlyCompleteMeaningAndRulesAreEligible(){
        assertEquals("READY",SourceBusinessPreflight.check(snapshot(entries(),rules(),List.of(List.of("001"))),columns));
        assertEquals("WAITING_SOURCE_DEFINITION",SourceBusinessPreflight.check(snapshot(List.of(),rules(),List.of(List.of("001"))),columns));
        assertEquals("WAITING_SOURCE_DEFINITION",SourceBusinessPreflight.check(snapshot(entries(),List.of(),List.of(List.of("001"))),columns));
    }
    @Test void modelDefinitionsWithoutSourceProofCanPublishButBadRowsStillFail() {
        var entry=new HashMap<>(entries().getFirst());entry.remove("proof");entry.put("status","MODEL_DETERMINED");
        var rule=new HashMap<>(rules().getFirst());rule.remove("evidence");
        var snapshot=snapshot(List.of(entry),List.of(rule),List.of(List.of("001")));
        assertEquals("READY",SourceBusinessPreflight.check(snapshot,columns));
        var field=SourceContractPublicationService.fields(snapshot.sourceContract(),columns).getFirst();
        assertEquals("MODEL_DETERMINED",field.status());assertEquals("",field.evidence());
        assertEquals("SOURCE_DATA_REQUIRES_REVIEW",SourceBusinessPreflight.check(snapshot(List.of(entry),List.of(rule),List.of(List.of("003"))),columns));
    }
    @Test void currentRowsAreValidatedIndependently(){
        assertEquals("SOURCE_DATA_REQUIRES_REVIEW",SourceBusinessPreflight.check(snapshot(entries(),rules(),List.of(List.of("003"))),columns));
        var pk=new ArrayList<>(rules());pk.add(Map.of("kind","column","name","编号","key","PRI"));
        assertEquals("SOURCE_DATA_REQUIRES_REVIEW",SourceBusinessPreflight.check(snapshot(entries(),pk,List.of(List.of("001"),List.of("001"))),columns));
    }
    @Test void technicalEvidenceOrUnsupportedRulesCannotBeApproved(){
        var technical=new HashMap<>(entries().getFirst());technical.put("definitionScope","TECHNICAL_ONLY");
        assertEquals("WAITING_SOURCE_DEFINITION",SourceBusinessPreflight.check(snapshot(List.of(technical),rules(),List.of(List.of("001"))),columns));
        var other=new ArrayList<>(rules());other.add(Map.of("kind","foreign-key"));
        assertEquals("WAITING_SOURCE_DEFINITION",SourceBusinessPreflight.check(snapshot(entries(),other,List.of(List.of("001"))),columns));
    }
    @Test void approvedDefinitionWithSourceLocatorRemainsCompatible(){
        var entry=new HashMap<>(entries().getFirst());entry.put("proof",List.of(Map.of("locator","合成官方字段定义/编号")));
        assertEquals("READY",SourceBusinessPreflight.check(snapshot(List.of(entry),rules(),List.of(List.of("001"))),columns));
    }
    @Test void missingUnitAndContradictoryNullableCannotSlipThrough() {
        var entry=new HashMap<>(entries().getFirst());entry.remove("declaredUnit");
        assertEquals("WAITING_SOURCE_DEFINITION",SourceBusinessPreflight.check(snapshot(List.of(entry),rules(),List.of(List.of("001"))),columns));
        var nullable=new HashMap<>(rules().getFirst());nullable.put("nullable",true);
        var constraints=List.of(nullable,Map.<String,Object>of("kind","column","name","编号","nullable","NO"));
        assertEquals("SOURCE_DATA_REQUIRES_REVIEW",SourceBusinessPreflight.check(snapshot(entries(),constraints,List.of(Arrays.asList((String)null))),columns));
    }
}
