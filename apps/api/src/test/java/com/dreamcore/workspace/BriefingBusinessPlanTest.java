package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.BriefingBusinessPlan;
import com.dreamcore.workspace.identity.IdentityException;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class BriefingBusinessPlanTest {
 BriefingBusinessPlan.Request request(List<String> stores,String from,String to){return new BriefingBusinessPlan.Request("本月五店销售收款是多少","股东查看经营概况","MONTHLY_SALES_RECEIPTS",stores,from,to);}
 @Test void mergesDistinctMetricsIntoOneFixedChart(){var p=BriefingBusinessPlan.resolve(request(List.of("store-b","store-a"),"2026-10-01","2026-10-19"));assertEquals(1,p.cards());assertEquals("GROUPED_BAR",p.chartStyle());assertEquals("2x2",p.size());assertEquals(List.of("orderSalesByConfirmationDate","businessConfirmed"),p.metrics());assertEquals(List.of("store-a","store-b"),p.storeIds());}
 @Test void rejectsDuplicateStoreAndAmbiguousPeriod(){assertThrows(IdentityException.class,()->BriefingBusinessPlan.resolve(request(List.of("a","a"),"2026-10-01","2026-10-19")));assertThrows(IdentityException.class,()->BriefingBusinessPlan.resolve(request(List.of("a","b"),"2026-09-01","2026-10-19")));assertThrows(IdentityException.class,()->BriefingBusinessPlan.resolve(request(List.of("a","b"),"2026-10-20","2026-10-19")));}
 @Test void refusesNewMetrics(){var r=request(List.of("a","b"),"2026-10-01","2026-10-19");assertThrows(IdentityException.class,()->BriefingBusinessPlan.resolve(new BriefingBusinessPlan.Request(r.question(),r.goal(),"PROFIT",r.storeIds(),r.dateFrom(),r.dateTo())));}
}
