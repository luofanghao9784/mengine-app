package com.dreamcore.workspace.analysis.governed;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class FusionPlannerTest {
 final JsonMapper json=new JsonMapper();final UUID tenant=UUID.randomUUID();
 FusionPlanner.Published metric(String id,String date){
  var d=new LinkedHashMap<String,Object>();d.put("name",id);d.put("unit","条");d.put("aggregation","COUNT");d.put("exclusions","无");
  d.put("execution",Map.of("reviewed",true,"groupColumns",List.of(),"dateColumn",date,"dateFrom",date.isEmpty()?"":"2026-01-01","dateTo",""));
  return new FusionPlanner.Published(UUID.randomUUID(),1,json.valueToTree(d));
 }
 FusionPlanner.Source dim(){return new FusionPlanner.Source("d",UUID.randomUUID(),UUID.randomUUID(),"组织","schema:d",Set.of("id","name"),2,json.valueToTree(Map.of()),List.of());}
 FusionPlanner.Source fact(String id,String fingerprint,boolean ambiguous,String date){
  var relation=Map.of("id","declared-key","name","归属对象","targetId","d","targetFingerprint",fingerprint,"evidence","approved source relationship","keys",List.of(Map.of("local","owner","foreign","id")));
  return new FusionPlanner.Source(id,UUID.randomUUID(),UUID.randomUUID(),id,"schema:"+id,Set.of("id","owner"),20,json.valueToTree(Map.of("dictionary",Map.of("relations",ambiguous?List.of(relation,relation):List.of(relation)))),List.of(metric(id,date)));
 }
 @Test void combinesTwoFactsThroughDeclaredSharedDimension(){var d=dim();var a=fact("a","schema:d",false,"");var b=fact("b","schema:d",false,"");var r=new FusionPlanner().choose(tenant,Set.of(a.dataset()),List.of(a,b,d)).orElseThrow();assertEquals(3,r.sources().size());assertEquals(2,r.calculation().metrics().size());assertEquals(2,r.relations().size());assertEquals(List.of("id"),r.relations().getFirst().foreign());}
 @Test void sameColumnNamesWithoutDeclaredCurrentRelationDoNotJoin(){var d=dim();var a=fact("a","old",false,"");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(a.dataset()),List.of(a,b,d)).isEmpty());}
 @Test void ambiguousAttributionRolesAreNotPickedArbitrarily(){var d=dim();var a=fact("a","schema:d",true,"");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(a.dataset()),List.of(a,b,d)).isEmpty());}
 @Test void datedPublishedMetricCannotLoseItsFilter(){var d=dim();var a=fact("a","schema:d",false,"date");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(a.dataset()),List.of(a,b,d)).isEmpty());}
 @Test void doesNotReplaceExplicitSelectionWithUnrelatedSources(){var d=dim();var a=fact("a","schema:d",false,"");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(UUID.randomUUID()),List.of(a,b,d)).isEmpty());}
 @Test void unrelatedInitialSelectionDoesNotImposeABusinessTableCountCap(){var d=dim();var a=fact("a","schema:d",false,"");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(a.dataset(),UUID.randomUUID()),List.of(a,b,d)).isPresent());}
 @Test void stableSchemaIdentityAcceptsRegisteredRelationWithoutUsingChangingRowFingerprint(){
  var old=dim();var d=new FusionPlanner.Source(old.sourceId(),old.dataset(),old.snapshot(),old.name(),"row-changing",old.columns(),old.rows(),json.valueToTree(Map.of("dictionarySchemaFingerprint","schema:d")),List.of());
  var a=fact("a","schema:d",false,"");var b=fact("b","schema:d",false,"");assertTrue(new FusionPlanner().choose(tenant,Set.of(a.dataset()),List.of(a,b,d)).isPresent());
 }
 @Test void graphIncludesMoreThanTwelveSourcesMoreThanSixMetricsAndMultiHopPaths(){
  var d=dim();var all=new ArrayList<FusionPlanner.Source>();all.add(d);
  var b=fact("bridge","schema:d",false,"");
  var bridge=new FusionPlanner.Source(b.sourceId(),b.dataset(),b.snapshot(),b.name(),b.fingerprint(),b.columns(),b.rows(),b.metadata(),List.of());all.add(bridge);
  for(int i=0;i<12;i++){
   var f=fact("fact"+i,"schema:bridge",false,"");var meta=f.metadata().deepCopy();
   ((tools.jackson.databind.node.ObjectNode)meta.at("/dictionary/relations/0")).put("targetId","bridge");
   all.add(new FusionPlanner.Source(f.sourceId(),f.dataset(),f.snapshot(),f.name(),f.fingerprint(),f.columns(),f.rows(),meta,List.of(metric("a"+i,""),metric("b"+i,""),metric("c"+i,""))));
  }
  var direct=fact("direct","schema:d",false,"");all.add(direct);
  var r=new FusionPlanner().choose(tenant,Set.of(direct.dataset()),all).orElseThrow();assertEquals(15,r.sources().size());assertEquals(37,r.measures().size());
  assertTrue(r.calculation().metrics().stream().anyMatch(m->m.joins().size()==2));
  var snapshots=new LinkedHashMap<String,FusionCalculator.Snapshot>();
  for(var binding:r.sources()){var src=all.stream().filter(x->x.dataset().equals(binding.dataset())).findFirst().orElseThrow();var row=new LinkedHashMap<String,String>();for(var column:src.columns())row.put(column,"one");snapshots.put(binding.alias(),new FusionCalculator.Snapshot(tenant,src.dataset(),src.snapshot(),"a".repeat(64),java.time.Instant.now(),src.columns(),List.of(row)));}
  var results=new FusionCalculator().calculate(r.calculation(),UUID.randomUUID(),snapshots,(t,a,v)->{});assertEquals(37,results.size());assertTrue(results.stream().allMatch(x->x.groups().getFirst().value().equals("1")));
 }
}
