package com.dreamcore.workspace.analysis.governed;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import com.dreamcore.workspace.analysis.governed.FusionCalculator.*;
class FusionCalculatorTest {
 final UUID tenant=UUID.randomUUID(),actor=UUID.randomUUID();
 Snapshot snapshot(Set<String> columns,List<Map<String,String>> rows){return new Snapshot(tenant,UUID.randomUUID(),UUID.randomUUID(),"a".repeat(64),Instant.now(),columns,rows);}
 Map<String,Snapshot> sources(){return Map.of(
  "orders",snapshot(Set.of("id","store","amount"),List.of(Map.of("id","a","store","s","amount","10.10"),Map.of("id","b","store","s","amount","20.20"))),
  "payments",snapshot(Set.of("id","order","amount"),List.of(Map.of("id","p1","order","a","amount","3.30"),Map.of("id","p2","order","a","amount","6.80"),Map.of("id","p3","order","b","amount","20.20"))),
  "stores",snapshot(Set.of("id","region"),List.of(Map.of("id","s","region","north"))));}
 List<Metric> metrics(){return List.of(
  new Metric("orders","登记金额","元","orders","SUM",new Field("orders","amount"),List.of(new Join("orders","stores",List.of("store"),List.of("id"))),List.of(new Dimension("region",new Field("stores","region"))),List.of()),
  new Metric("payments","收款登记","元","payments","SUM",new Field("payments","amount"),List.of(new Join("payments","orders",List.of("order"),List.of("id")),new Join("orders","stores",List.of("store"),List.of("id"))),List.of(new Dimension("region",new Field("stores","region"))),List.of()));}
 Plan plan(List<Metric> metrics){return new Plan(tenant,UUID.randomUUID(),1,metrics);}
 @Test void factsAggregateIndependentlyWithoutFanoutAndDecimalsAreExact(){var r=new FusionCalculator().calculate(plan(metrics()),actor,sources(),(t,a,s)->{});assertEquals("30.30",r.get(0).groups().getFirst().value());assertEquals("30.30",r.get(1).groups().getFirst().value());assertEquals(2,r.get(0).includedRecords());assertEquals(3,r.get(1).includedRecords());}
 @Test void duplicateDimensionKeysRejectInsteadOfInflatingTotals(){var s=new HashMap<>(sources());s.put("stores",snapshot(Set.of("id","region"),List.of(Map.of("id","s","region","north"),Map.of("id","s","region","south"))));var e=assertThrows(Rejected.class,()->new FusionCalculator().calculate(plan(metrics()),actor,s,(t,a,x)->{}));assertEquals("FUSION_JOIN_NOT_MANY_TO_ONE",e.code);}
 @Test void crossTenantSnapshotRejectedBeforeReading(){var s=new HashMap<>(sources());var v=s.get("stores");s.put("stores",new Snapshot(UUID.randomUUID(),v.dataset(),v.version(),v.sha256(),v.collectedAt(),v.columns(),v.rows()));assertThrows(Rejected.class,()->new FusionCalculator().calculate(plan(metrics()),actor,s,(t,a,x)->{}));}
 @Test void dimensionMeasureCannotBeSummedOncePerFact(){var m=metrics().get(1);var bad=new Metric(m.id(),m.label(),m.unit(),m.base(),m.aggregation(),new Field("orders","amount"),m.joins(),m.dimensions(),m.filters());var e=assertThrows(Rejected.class,()->new FusionCalculator().calculate(plan(List.of(metrics().getFirst(),bad)),actor,sources(),(t,a,s)->{}));assertEquals("FUSION_MEASURE_GRAIN_MISMATCH",e.code);}
 @Test void revocationAtCompletionSuppressesWholeBundle(){var calls=new int[]{0};assertThrows(SecurityException.class,()->new FusionCalculator().calculate(plan(metrics()),actor,sources(),(t,a,s)->{if(++calls[0]>3)throw new SecurityException();}));}
 @Test void unmatchedRelationsRemainExplicitAndNeverBecomeAnInnerJoin(){var s=new HashMap<>(sources());s.put("stores",snapshot(Set.of("id","region"),List.of()));var r=new FusionCalculator().calculate(plan(metrics()),actor,s,(t,a,x)->{});assertEquals("30.30",r.getFirst().groups().getFirst().value());assertNull(r.getFirst().groups().getFirst().dimensions().getFirst());assertEquals(2,r.getFirst().unmatched().get("stores"));}
}
