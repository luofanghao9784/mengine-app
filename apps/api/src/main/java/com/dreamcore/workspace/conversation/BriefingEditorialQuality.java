package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.regex.Pattern;
/** Deterministic publication checks for automatic business briefings; not a replacement for evidence validation. */
public final class BriefingEditorialQuality {
 private BriefingEditorialQuality() {}
 private static final Pattern INTERNAL=Pattern.compile("(?i)\\b(compare_dataset|deliver_briefing|dataset_read|completeDataset|businessType|finance_confirmed|canceled|deposit|DATA|INSIGHT|UUID|JSON|API)\\b|快照ID|(?:收款|订单|会员)ID|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}");
 private static final Pattern INVENTORY=Pattern.compile("数据集结构|字段清单|结构概览|时间覆盖说明|数据结构与|(?:包含|包括)[0-9一二三四五六七八九十]+个字段");
 private static final Pattern QUANTITY=Pattern.compile("占比|比例|多数|大多数|主要形式|以.{0,12}为主|增长|下降|同比|环比|排名|最高|最低|领先|\\d+(?:\\.\\d+)?[%％]");
 public static void validate(BriefingContentService.Request r,boolean automatic,boolean datasetEvidence,boolean computed){
  if(!automatic)return;
  String text=r.title()+"\n"+r.summary()+"\n"+String.join("\n",r.analysis());
  if(INTERNAL.matcher(text).find())throw new IdentityException(422,"BRIEFING_INTERNAL_LANGUAGE");
  if(INVENTORY.matcher(text).find())throw new IdentityException(422,"BRIEFING_NO_BUSINESS_INSIGHT");
  String assertions=java.util.Arrays.stream(text.split("[。！？；\n]")).filter(sentence->!sentence.matches(".*(建议|尚未|无法|不能|待核实|未统计|需要统计|应核实).*" )).collect(java.util.stream.Collectors.joining("\n"));
  if(datasetEvidence&&!computed&&QUANTITY.matcher(assertions).find())throw new IdentityException(422,"BRIEFING_UNVERIFIED_QUANTITY");
  // A ratio/count is not proved by a grouped-sum artifact either. Until that recipe exists, avoid such claims.
  if(datasetEvidence&&Pattern.compile("占比|比例|多数|大多数|主要形式").matcher(assertions).find())throw new IdentityException(422,"BRIEFING_RATIO_NOT_VERIFIED");
 }
}
