package com.dreamcore.workspace.context;
import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.identity.IdentityException;
import java.nio.file.*;import java.util.*;
import org.junit.jupiter.api.Test;import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class NativeAnalysisPlansTest {
 @TempDir Path dir;
 UUID tenant=UUID.randomUUID(),dataset=UUID.randomUUID(),snapshot=UUID.randomUUID();
 List<DatasetField> fields=List.of(new DatasetField("门店","text","来源门店","","合成来源","SOURCE_DOCUMENTED"),new DatasetField("金额","decimal","登记金额","人民币元","合成来源","SOURCE_DOCUMENTED"));
 Map<String,Object> definition(){return new LinkedHashMap<>(Map.of("name","合成门店登记额","meaning","来源登记额，非银行到账","unit","人民币元","grain","来源记录","scope","全部当前快照","exclusions","无","evidence","合成部署核对","aggregation","SUM","valueField","金额","execution",Map.of("groupColumns",List.of("门店"),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true)));}
 String config(Map<String,Object> d)throws Exception{Path p=dir.resolve("evidence.json");Files.writeString(p,new JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"schema",List.of(Map.of("datasetId",dataset.toString(),"kind","analysis-plan","definition",d)))));return p.toString();}
 @Test void reviewedSourceSummaryBindsCurrentDatasetSnapshotAndExactUnitWithoutLegacyMetricId()throws Exception{
  var out=NativeAnalysisPlans.load(config(definition()),tenant,dataset,snapshot,"合成表",List.of("门店","金额"),fields);
  var items=(List<?>)out.get("items");assertEquals(1,items.size());var item=(Map<?,?>)items.getFirst();var req=new JsonMapper().valueToTree(item.get("executionRequest"));
  assertEquals(dataset.toString(),req.path("datasetId").asText());assertEquals(snapshot.toString(),req.path("snapshotId").asText());assertEquals("金额",req.path("valueColumn").asText());assertEquals("SUMMARY",req.path("operation").asText());assertFalse(req.has("metricId"));assertFalse(req.has("metricVersion"));
  var selected=new JsonMapper().valueToTree(item.get("selection"));assertEquals(snapshot.toString(),selected.path("snapshotId").asText());assertEquals(dataset.toString(),selected.path("datasetId").asText());assertEquals(1,selected.path("metricVersion").asInt());assertNotNull(UUID.fromString(selected.path("metricId").asText()));assertFalse(req.has("rows"));assertEquals(false,out.get("authority"));
 }
 @Test void unknownFieldsUnitsAndUnreviewedOrExcludedPlansCannotBecomeInstalledMethods()throws Exception{
  var d=definition();String path=config(d);var unknown=List.of(fields.getFirst(),new DatasetField("金额","decimal","未知","人民币元","无","UNKNOWN"));
  assertThrows(IdentityException.class,()->NativeAnalysisPlans.load(path,tenant,dataset,snapshot,"表",List.of("门店","金额"),unknown));
  d.put("unit","人民币分");String mismatch=config(d);assertThrows(IdentityException.class,()->NativeAnalysisPlans.load(mismatch,tenant,dataset,snapshot,"表",List.of("门店","金额"),fields));
  d=definition();d.put("exclusions","排除待确认记录");String excluded=config(d);assertThrows(IdentityException.class,()->NativeAnalysisPlans.load(excluded,tenant,dataset,snapshot,"表",List.of("门店","金额"),fields));
 }
 @Test void tenantAndDatasetIdentityCannotBorrowAnotherInstalledMethod()throws Exception{
  String path=config(definition());assertTrue(((List<?>)NativeAnalysisPlans.load(path,UUID.randomUUID(),dataset,snapshot,"表",List.of("门店","金额"),fields).get("items")).isEmpty());assertTrue(((List<?>)NativeAnalysisPlans.load(path,tenant,UUID.randomUUID(),snapshot,"表",List.of("门店","金额"),fields).get("items")).isEmpty());
 }
}
