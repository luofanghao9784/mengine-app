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
}
