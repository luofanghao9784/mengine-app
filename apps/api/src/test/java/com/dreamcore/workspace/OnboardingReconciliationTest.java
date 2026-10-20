package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.OnboardingReconciliation;
import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class OnboardingReconciliationTest {
 Map<String,String> row(String... pairs){var m=new HashMap<String,String>();for(int i=0;i<pairs.length;i+=2)m.put(pairs[i],pairs[i+1]);return m;}
 Map<String,List<Map<String,String>>> fixture(){return new HashMap<>(Map.of("full_orders",new ArrayList<>(List.of(row("id","o","store_id","s","member_course_id","c","order_status","completed","deleted_at",null))),"payment_orders",new ArrayList<>(List.of(row("id","p","store_id","s","full_order_id","o","status","finance_confirmed","paid_amount_cents","9007199254740993","confirmed_at","2026-10-01 00:00:00","finance_checked_at","2026-10-02 00:00:00"))),"t_course_refund_records",new ArrayList<>(List.of(row("id","r","store_id","s","member_course_id","c","status","applied","actual_refund_payout_cents",null,"applied_at","2026-10-01 23:59:59","paid_at",null)))));}
 OnboardingReconciliation.Result run(Map<String,List<Map<String,String>>> f){return OnboardingReconciliation.evaluate(f,"s",LocalDate.parse("2026-10-01"),LocalDate.parse("2026-10-01"));}
 @Test void exactAmountsSeparateDatesAndUnknownRefund(){var r=run(fixture());assertEquals("9007199254740993",r.amounts().get("businessConfirmed").cents());assertEquals(1,r.amounts().get("financeReviewedByReviewDate").outside());assertEquals(1,r.amounts().get("cashRefund").unknown());}
 @Test void nullDateNotCreatedDate(){var f=fixture();f.get("payment_orders").getFirst().put("confirmed_at",null);assertEquals(1,run(f).amounts().get("businessConfirmed").unknown());}
 @Test void zeroCashRequiresNoPaidDate(){var f=fixture();f.get("t_course_refund_records").getFirst().put("actual_refund_payout_cents","0");assertEquals(0,run(f).amounts().get("cashRefund").unknown());}
 @Test void cancelParentNotIncome(){var f=fixture();f.get("full_orders").getFirst().put("deleted_at","2026-10-02");assertEquals("0",run(f).amounts().get("businessConfirmed").cents());assertEquals("EVIDENCE_GAP",run(f).issues().getFirst().category());}
 @Test void mixedStoreRejected(){var f=fixture();f.get("payment_orders").getFirst().put("store_id","other");assertThrows(IllegalArgumentException.class,()->run(f));}
 @Test void duplicateKeyRejected(){var f=fixture();f.get("full_orders").add(f.get("full_orders").getFirst());assertThrows(IllegalArgumentException.class,()->run(f));}
 @Test void oneToManyNotDoubleCountParent(){var f=fixture();var p=new HashMap<>(f.get("payment_orders").getFirst());p.put("id","p2");p.put("paid_amount_cents","7");f.get("payment_orders").add(p);assertEquals("9007199254741000",run(f).amounts().get("businessConfirmed").cents());}
 @Test void offsetAndBoundary(){var f=fixture();f.get("payment_orders").getFirst().put("confirmed_at","2026-09-30T16:00:00Z");assertEquals(1,run(f).amounts().get("businessConfirmed").included());}
 @Test void orderSalesUseConfirmationMonthAndCountParentOnce(){var f=fixture();var o=f.get("full_orders").getFirst();o.put("confirmed_at","2026-09-30T16:00:00Z");o.put("total_amount_cents","100000");var p=new HashMap<>(f.get("payment_orders").getFirst());p.put("id","second");f.get("payment_orders").add(p);var a=run(f).amounts().get("orderSalesByConfirmationDate");assertEquals("100000",a.cents());assertEquals(1,a.included());o.put("confirmed_at","2026-09-30 23:59:59");assertEquals(1,run(f).amounts().get("orderSalesByConfirmationDate").outside());}
 @Test void canceledDeletedAndUnconfirmedOrdersAreNotSales(){var f=fixture();var o=f.get("full_orders").getFirst();o.put("total_amount_cents","100000");assertEquals(1,run(f).amounts().get("orderSalesByConfirmationDate").unknown());o.put("confirmed_at","2026-10-01 00:00:00");o.put("order_status","canceled");assertEquals("0",run(f).amounts().get("orderSalesByConfirmationDate").cents());o.put("order_status","completed");o.put("deleted_at","2026-10-02");assertEquals("0",run(f).amounts().get("orderSalesByConfirmationDate").cents());}
}
