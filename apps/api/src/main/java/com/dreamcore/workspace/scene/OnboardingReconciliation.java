package com.dreamcore.workspace.scene;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;

/** Fixed 9POP first-batch recipe. No SQL, model code, writes, or inferred cash facts. */
public final class OnboardingReconciliation {
 public static final String VERSION="ninepop-first-three-v1";
 public record Issue(String table,String id,String category,String reason) {}
 public record Amount(String cents,int included,int outside,int unknown) {}
 public record Result(String ruleVersion,Map<String,Amount> amounts,List<Issue> issues,int records) {}
 static class Bucket {BigDecimal sum=BigDecimal.ZERO;int included,outside,unknown;
  Amount result(){return new Amount(sum.toPlainString(),included,outside,unknown);}}
 static final Set<String> RECEIVED=Set.of("confirmed_pending_voucher","voucher_uploaded","finance_rejected","finance_confirmed");
 static String value(Map<String,String> r,String k){return r.get(k);}
 static void issue(List<Issue> out,String table,Map<String,String> row,String category,String reason){out.add(new Issue(table,row.get("id"),category,reason));}
 static boolean period(String raw,LocalDate from,LocalDate to){
  if(raw==null||raw.isBlank())throw new IllegalArgumentException("Missing date");
  String date=raw.replace(' ','T');LocalDate day;
  try{day=OffsetDateTime.parse(date).atZoneSameInstant(ZoneId.of("Asia/Shanghai")).toLocalDate();}
  catch(java.time.format.DateTimeParseException e){day=LocalDateTime.parse(date).toLocalDate();}
  return !day.isBefore(from)&&!day.isAfter(to);
 }
 static void add(Bucket b,Map<String,String> r,String amount,String date,LocalDate from,LocalDate to){
  try{
   if(!period(r.get(date),from,to)){b.outside++;return;}
   if(r.get(amount)==null||!r.get(amount).matches("[0-9]+"))throw new IllegalArgumentException("Unknown amount");
   b.sum=b.sum.add(new BigDecimal(r.get(amount)));b.included++;
  }catch(IllegalArgumentException|java.time.DateTimeException ex){b.unknown++;}
 }
 public static Result evaluate(Map<String,List<Map<String,String>>> tables,String store,LocalDate from,LocalDate to){
  if(from==null||to==null||from.isAfter(to))throw new IllegalArgumentException("Invalid period");
  var required=Map.of("full_orders",Set.of("id","store_id","member_course_id","order_status","deleted_at"),"payment_orders",Set.of("id","store_id","full_order_id","status","paid_amount_cents","confirmed_at","finance_checked_at"),"t_course_refund_records",Set.of("id","store_id","member_course_id","status","actual_refund_payout_cents","applied_at","paid_at"));
  int records=0;
  for(var entry:required.entrySet()){
   var rows=tables.get(entry.getKey());if(rows==null)throw new IllegalArgumentException("Missing table");var ids=new HashSet<String>();
   for(var r:rows){if(!r.keySet().containsAll(entry.getValue())||!store.equals(r.get("store_id"))||r.get("id")==null||!ids.add(r.get("id")))throw new IllegalArgumentException("Invalid scope/schema/key");records++;}
  }
  var orders=new HashMap<String,Map<String,String>>();tables.get("full_orders").forEach(r->orders.put(r.get("id"),r));
  var issues=new ArrayList<Issue>();var buckets=new LinkedHashMap<String,Bucket>();
  for(String k:List.of("orderSalesByConfirmationDate","businessConfirmed","financeConfirmedByReceiptDate","financeReviewedByReviewDate","cashRefund"))buckets.put(k,new Bucket());
  // Order value is counted once per confirmed, active order, independently of payment installments.
  for(var r:tables.get("full_orders")){
   if(r.get("deleted_at")!=null||"canceled".equals(r.get("order_status")))continue;
   if(r.get("confirmed_at")==null||r.get("confirmed_at").isBlank()){
    buckets.get("orderSalesByConfirmationDate").unknown++;continue;
   }
   add(buckets.get("orderSalesByConfirmationDate"),r,"total_amount_cents","confirmed_at",from,to);
  }
  for(var r:tables.get("payment_orders")){
   var p=orders.get(r.get("full_order_id"));String status=r.get("status");
   if(p==null){issue(issues,"payment_orders",r,"EVIDENCE_GAP","PARENT_UNAVAILABLE");continue;}
   if(p.get("deleted_at")!=null||"canceled".equals(p.get("order_status"))){issue(issues,"payment_orders",r,"canceled".equals(status)?"EXPLAINED_HISTORY":"EVIDENCE_GAP","PARENT_CANCELED_OR_DELETED");continue;}
   if("canceled".equals(status))continue;
   if(status==null||!RECEIVED.contains(status)){issue(issues,"payment_orders",r,"EVIDENCE_GAP","STATUS_NOT_INCLUDED");continue;}
   add(buckets.get("businessConfirmed"),r,"paid_amount_cents","confirmed_at",from,to);
   if("finance_confirmed".equals(status)){
    add(buckets.get("financeConfirmedByReceiptDate"),r,"paid_amount_cents","confirmed_at",from,to);
    add(buckets.get("financeReviewedByReviewDate"),r,"paid_amount_cents","finance_checked_at",from,to);
   }else issue(issues,"payment_orders",r,"WORK_QUEUE",status);
   try{period(r.get("confirmed_at"),from,to);}catch(RuntimeException ex){issue(issues,"payment_orders",r,"EVIDENCE_GAP","RECEIPT_DATE_MISSING_OR_INVALID");}
  }
  for(var r:tables.get("t_course_refund_records")){
   long candidates=tables.get("full_orders").stream().filter(o->r.get("member_course_id")!=null&&r.get("member_course_id").equals(o.get("member_course_id"))).count();
   if(candidates!=1)issue(issues,"t_course_refund_records",r,"EVIDENCE_GAP","ORDER_RELATION_UNPROVEN");
   if(!"applied".equals(r.get("status"))){issue(issues,"t_course_refund_records",r,"WORK_QUEUE","REFUND_NOT_APPLIED");continue;}
   try{period(r.get("applied_at"),from,to);}catch(RuntimeException ex){issue(issues,"t_course_refund_records",r,"EVIDENCE_GAP","REFUND_APPLIED_DATE_MISSING_OR_INVALID");}
   String cash=r.get("actual_refund_payout_cents");
   if(cash==null||!cash.matches("[0-9]+")){buckets.get("cashRefund").unknown++;issue(issues,"t_course_refund_records",r,"EVIDENCE_GAP","REFUND_PAYOUT_UNKNOWN");continue;}
   if(new BigDecimal(cash).signum()==0){issue(issues,"t_course_refund_records",r,"EXPLAINED_HISTORY","ZERO_CASH_SETTLEMENT");continue;}
   int unknown=buckets.get("cashRefund").unknown;add(buckets.get("cashRefund"),r,"actual_refund_payout_cents","paid_at",from,to);
   if(buckets.get("cashRefund").unknown>unknown)issue(issues,"t_course_refund_records",r,"EVIDENCE_GAP","REFUND_PAYMENT_DATE_MISSING_OR_INVALID");
  }
  var amounts=new LinkedHashMap<String,Amount>();buckets.forEach((k,v)->amounts.put(k,v.result()));return new Result(VERSION,amounts,List.copyOf(issues),records);
 }
}
