package com.dreamcore.workspace.conversation;
import java.util.*;
/** Platform-owned 9POP dictionary, keyed by deployed dataset and exact column; never a calculation input. */
public final class BriefingDisplayLabels {
 private BriefingDisplayLabels() {}
 public record Labels(Map<String,String> groups,Map<String,String> columns) {}
 public static Map<String,String> dictionary(String dataset,String column){
  return switch(dataset+":"+column){
   case "ninepop_members_v1:会员状态" -> Map.ofEntries(Map.entry("pending_start","待开课"),Map.entry("active","开课中"),Map.entry("trial","体验中"),Map.entry("final_payment_pending","尾款限制"),Map.entry("on_leave","请假中"),Map.entry("frozen","停卡中"),Map.entry("finished","已结束"),Map.entry("guarantee_renewal","保底续期"),Map.entry("refunded","已退款"),Map.entry("unpurchased","未购课"));
   case "ninepop_course_entitlements_v1:课程状态" -> Map.of(
     "pending_start","待开课","active","开课中","on_leave","请假中",
     "frozen","停卡中","final_payment_pending","尾款限制","finished","已结束",
     "guarantee_renewal","保底续期","refunded","已退款","canceled","已取消");
   case "ninepop_payments_v1:收款状态" -> Map.of("pending_confirmation","待确认收款","confirmed_pending_voucher","已确认待补凭证","voucher_uploaded","待财务审核","finance_rejected","财务退回","finance_confirmed","财务已确认","canceled","已取消");
   case "ninepop_payments_v1:收款类型" -> Map.of("full","全款","deposit","定金","final","尾款");
   case "ninepop_orders_v1:订单状态" -> Map.of("pending_first_payment","待首款","pending_voucher","待补凭证","pending_final_payment","待尾款","completed","已完成","canceled","已取消","refunded","已退款");
   case "ninepop_sessions_v1:课时状态" -> Map.of("effective","有效","voided","已作废");
   default -> Map.of();
  };
 }
 public static Labels forContent(String dataset,BriefingContentService.Content content){
  if(content.chart()==null||content.datasetBasis()==null)return null;
  var groups=new LinkedHashMap<String,String>();var columns=new LinkedHashMap<String,String>();
  var g=dictionary(dataset,content.datasetBasis().groupColumn());var c=dictionary(dataset,content.datasetBasis().periodColumn());
  for(var row:content.chart().rows())if(g.containsKey(row.group()))groups.put(row.group(),g.get(row.group()));
  for(String raw:List.of(content.chart().baseline(),content.chart().current()))if(c.containsKey(raw))columns.put(raw,c.get(raw));
  return new Labels(Map.copyOf(groups),Map.copyOf(columns));
 }
}
