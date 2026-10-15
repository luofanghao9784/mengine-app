package com.dreamcore.workspace.conversation;
import java.util.*;
/** Platform-owned 9POP dictionary, keyed by deployed dataset and exact column; never a calculation input. */
public final class BriefingDisplayLabels {
 private BriefingDisplayLabels() {}
 public record Labels(Map<String,String> groups,Map<String,String> columns,String unit,String range) {}
 public static Map<String,String> dictionary(String dataset,String column){
  if(dataset.startsWith("ninepop-chain-")) {
   var labels=switch(column){
    case "课程状态" -> dictionary("ninepop_course_entitlements_v1",column);
    case "订单状态" -> dictionary("ninepop_orders_v1",column);
    case "转店状态" -> Map.of("withdrawn","已撤回","effective","已生效");
    case "开课状态" -> Map.of("active","有效开课","canceled","已取消","voided","已作废");
    case "审批状态" -> Map.of("approved","已通过","withdrawn","已撤回","in_progress","审批中","rejected","已驳回");
    case "课时状态" -> Map.of("effective","有效课时","voided","已作废","pending_cross_store_claim","跨店待认领","cross_store_expired_unclaimed","跨店过期未认领");
    case "财务处理" -> Map.of("income_reduction","冲减原收入","refund_expense","退款支出");
    case "产品类别" -> Map.of("formal","正式课","trial","体验课");
    default -> Map.<String,String>of();
   };
   return labels;
  }
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
  for(var row:content.chart().rows()) {
   if(row.group()==null)continue;
   if(g.containsKey(row.group()))groups.put(row.group(),g.get(row.group()));
   else if(dataset.startsWith("ninepop-chain-")) {
    var names=content.datasetBasis().groupColumn().split(" / ");var values=row.group().split(" / ",-1);
    if(names.length==values.length){for(int i=0;i<names.length;i++){
     var mapping=dictionary(dataset,names[i]);
     values[i]=mapping.getOrDefault(values[i],!mapping.isEmpty()&&values[i].matches("[a-z_]+")?"待核实分类":values[i]);
    }groups.put(row.group(),String.join(" / ",values));}
   }
  }
  for(String raw:List.of(content.chart().baseline(),content.chart().current()))if(c.containsKey(raw))columns.put(raw,c.get(raw));
  String unit=null,range=null;
  if(dataset.startsWith("ninepop-chain-")) {
   unit=switch(content.chart().metric()) {
    case "申请数","订单数","转店单数","财务确认收款笔数","退款记录数" -> "笔";
    case "课程数","开课数" -> "份";
    case "课时数","结算事件数","处理动作数" -> "条";
    default -> content.chart().unit().equals("原数据数值单位")?"":content.chart().unit();
   };
   range=content.datasetSource()==null?null:(content.datasetSource().coverageThrough()==null?"采集时间 ":"数据截至 ")+java.time.format.DateTimeFormatter.ofPattern("yyyy年M月d日 HH:mm").withZone(java.time.ZoneId.of("Asia/Shanghai")).format(java.time.Instant.parse(content.datasetSource().coverageThrough()==null?content.datasetSource().collectedAt():content.datasetSource().coverageThrough()));
  }
  return new Labels(Map.copyOf(groups),Map.copyOf(columns),unit,range);
 }
}
