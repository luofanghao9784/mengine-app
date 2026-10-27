package com.dreamcore.workspace.collection;
import org.junit.jupiter.api.Test;import static org.junit.jupiter.api.Assertions.*;import java.nio.file.*;import java.util.*;import tools.jackson.databind.json.JsonMapper;
class SourceRuleConformanceTest {
 @Test void sameContractCasesAsPythonCollector() throws Exception {
  var json=new JsonMapper();var suite=json.readTree(Files.readString(Path.of("../../contracts/source-rules/conformance-v1.json")));
  for(var c:suite.path("cases")){
   var body=json.createObjectNode();body.set("entries",c.path("entries"));body.set("schema",c.path("schema"));
   UUID id=UUID.randomUUID();var contract=new CollectionAdapter.SourceContract("1.0",UUID.randomUUID(),id,1,"synthetic",body.toString());
   List<String> columns=json.convertValue(c.path("columns"),List.class);List<List<String>> rows=json.convertValue(c.path("rows"),List.class);
   assertEquals(c.path("expected").asText(),SourceBusinessPreflight.check(new CollectionAdapter.Snapshot(id,null,rows,null,contract),columns),c.path("id").asText());
  }
 }
}
