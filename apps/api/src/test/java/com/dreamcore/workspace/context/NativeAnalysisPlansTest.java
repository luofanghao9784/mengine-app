package com.dreamcore.workspace.context;
import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.identity.IdentityException;
import java.nio.file.*;import java.util.*;
import java.time.Instant;
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
 Map<String,Object> monthly(String window){var d=definition();d.put("calendarWindow",window);d.put("execution",Map.of("groupColumns",List.of("门店"),"dateColumn","应收付日","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));return d;}
 List<DatasetField> dated(){var result=new ArrayList<>(fields);result.add(new DatasetField("应收付日","date","账单应收付日期，不是实际到账日期","","合成来源","SOURCE_DOCUMENTED"));return result;}
 tools.jackson.databind.JsonNode resolved(String path,Instant at){return new JsonMapper().valueToTree(((List<?>)NativeAnalysisPlans.load(path,tenant,dataset,snapshot,"合成表",List.of("门店","金额","应收付日"),dated(),at).get("items")).getFirst());}
 @Test void calendarWindowUsesPersistedTaskTimeInShanghaiAndRetainsLeapYearAndYearBoundary()throws Exception{
  String path=config(monthly("CURRENT_MONTH"));var item=resolved(path,Instant.parse("2024-01-31T16:00:00Z"));assertEquals("2024-02",item.at("/definition/resolvedCalendarMonth").asText());assertEquals("2024-02-01",item.at("/executionRequest/dateFrom").asText());assertEquals("2024-02-29",item.at("/executionRequest/dateTo").asText());assertEquals("应收付日",item.at("/executionRequest/dateColumn").asText());assertEquals("FAIL",item.at("/executionRequest/missingDates").asText());
  assertEquals(item,resolved(path,Instant.parse("2024-01-31T16:00:00Z")));assertNotEquals(item.at("/selection/metricId"),resolved(path,Instant.parse("2024-03-01T00:00:00Z")).at("/selection/metricId"));
  path=config(monthly("PREVIOUS_MONTH"));item=resolved(path,Instant.parse("2026-01-01T00:00:00Z"));assertEquals("2025-12-01",item.at("/executionRequest/dateFrom").asText());assertEquals("2025-12-31",item.at("/executionRequest/dateTo").asText());assertFalse(item.toString().contains("coverageThrough"));
 }
 @Test void rollingWindowRequiresExplicitTaskAnchorConfirmedDateAndNoConflictingFixedRange()throws Exception{
  String path=config(monthly("CURRENT_MONTH"));assertThrows(IdentityException.class,()->NativeAnalysisPlans.load(path,tenant,dataset,snapshot,"表",List.of("门店","金额","应收付日"),dated()));
  var wrong=new ArrayList<>(fields);wrong.add(new DatasetField("应收付日","text","未知日期","","无","UNKNOWN"));assertThrows(IdentityException.class,()->NativeAnalysisPlans.load(path,tenant,dataset,snapshot,"表",List.of("门店","金额","应收付日"),wrong,Instant.parse("2026-10-26T00:00:00Z")));
  for(String window:List.of("LAST_30_DAYS","CURRENT_MONTH")){var d=monthly(window);if(window.equals("CURRENT_MONTH")){var execution=new LinkedHashMap<>((Map<String,Object>)d.get("execution"));execution.put("dateFrom","2026-01-01");d.put("execution",execution);}String invalid=config(d);assertThrows(IdentityException.class,()->resolved(invalid,Instant.parse("2026-10-26T00:00:00Z")));}
 }
}
