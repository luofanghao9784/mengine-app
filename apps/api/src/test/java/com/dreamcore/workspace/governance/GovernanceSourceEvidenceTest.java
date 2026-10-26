package com.dreamcore.workspace.governance;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

class GovernanceSourceEvidenceTest {
 @TempDir Path root;
 @Test void databaseExportAndApiEvidenceShareAContractWithoutMixingSameNamedTables() throws Exception {
  UUID tenant=UUID.randomUUID();var ids=List.of(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID());
  var kinds=List.of("FILE_EXPORT","DATABASE","PLATFORM_API");var entries=new ArrayList<Map<String,Object>>();
  for(int i=0;i<3;i++)entries.add(Map.of("datasetId",ids.get(i).toString(),"table","同名订单","column","id","sourceKind",kinds.get(i),"sourceMetadata",Map.of("description","合成来源明确记录其编号字段含义")));
  Path file=root.resolve("evidence.json");Files.writeString(file,new JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",entries)));
  for(int i=0;i<3;i++) {
   var selected=GovernanceSourceEvidence.read(file.toString(),tenant,ids.get(i),"任意展示名称","entries",false);
   assertEquals(1,selected.size());assertEquals(kinds.get(i),selected.getFirst().get("sourceKind"));
  }
  assertTrue(GovernanceSourceEvidence.read(file.toString(),UUID.randomUUID(),ids.getFirst(),"同名订单","entries",false).isEmpty());
 }
 @Test void ambiguousLegacyNamesDoNotBecomeEvidenceForAnotherSource() throws Exception {
  UUID tenant=UUID.randomUUID(),dataset=UUID.randomUUID();Path file=root.resolve("legacy.json");
  Files.writeString(file,new JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("table","订单","column","id","proof",List.of())))));
  assertEquals(1,GovernanceSourceEvidence.read(file.toString(),tenant,dataset,"订单","entries",true).size());
  assertTrue(GovernanceSourceEvidence.read(file.toString(),tenant,dataset,"订单","entries",false).isEmpty());
 }
}
