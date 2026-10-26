package com.dreamcore.workspace.analysis.governed;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.conversation.BriefingContentService;
import com.dreamcore.workspace.conversation.CalculatedBriefingNarrative;
/** Numeric prose is limited to computed values; the table remains the authoritative presentation. */
public final class FusionNarrativeEvidence {
 private static final Pattern NUMBER=Pattern.compile("(?<![A-Za-z])[-+]?\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:万|亿)?");
 private static String key(String s){return new BigDecimal(s).stripTrailingZeros().toPlainString();}
 public static void validate(String prose,JsonNode evidence){
  Set<String> allowed=new HashSet<>();
  for(var r:evidence.path("results")){
   prose=prose.replace(r.path("label").asText(),"");
   for(String field:List.of("total","baseRecords","includedRecords"))allowed.add(key(r.path(field).asText()));
   for(var g:r.path("groups")){allowed.add(key(g.path("value").asText()));allowed.add(key(g.path("records").asText()));}
   r.path("unmatched").properties().forEach(e->allowed.add(key(e.getValue().asText())));
  }
  for(var e:evidence.path("dimensionLabels").properties())prose=prose.replace(e.getValue().asText(),"");
  for(var s:evidence.path("sources")){prose=prose.replace(s.path("name").asText(),"");allowed.add(key(s.path("rowCount").asText()));}
  var matcher=NUMBER.matcher(prose);
  while(matcher.find()){
   String raw=matcher.group().replace(",","");BigDecimal scale=BigDecimal.ONE;
   if(raw.endsWith("万")||raw.endsWith("亿")){scale=new BigDecimal(raw.endsWith("万")?"10000":"100000000");raw=raw.substring(0,raw.length()-1);}
   if(!allowed.contains(key(new BigDecimal(raw).multiply(scale).toPlainString())))throw new IdentityException(422,"FUSION_NUMBER_NOT_VERIFIED");
  }
 }
 /** Publication uses label/value bindings; matching an unlabelled numeric whitelist is insufficient. */
 public static BriefingContentService.Request render(BriefingContentService.Request request,JsonNode evidence){
  var results=evidence.path("results");if(results.size()<2)throw new IdentityException(422,"FUSION_RESULT_INVALID");
  var paragraphs=new ArrayList<String>();
  for(int i=0;i<2;i++){
   var r=results.get(i);String metric="「"+shortLabel(r.path("label").asText(),80)+"」";
   paragraphs.add(metric+"登记合计 "+r.path("total").asText()+" "+shortLabel(r.path("unit").asText(),24)+"，来源记录 "+r.path("baseRecords").asInt()+" 条，实际纳入 "+r.path("includedRecords").asInt()+" 条，形成 "+r.path("groups").size()+" 个关联分组。各指标按自己的事实记录独立统计，未把关联后的重复行作为额外金额。");
  }
  paragraphs.add("本次完整结果包含 "+results.size()+" 项已核验指标，按「"+shortLabel(evidence.path("dimensionName").asText("已发布关联维度"),80)+"」对齐展示；正文展开前两项，全部指标、来源和未匹配数量保留在关联结果表中。金额相同不证明逐笔结算一致，金额不同也不能直接认定漏收或损失。");
  String advice=CalculatedBriefingNarrative.suggestedAction(request.analysis());
  paragraphs.add("登记值仅覆盖本次固定来源版本及各指标已发布的筛选条件，不代表实时银行到账、收入或利润。业务建议："+advice);
  String title=shortLabel(results.get(0).path("label").asText(),22)+"与"+shortLabel(results.get(1).path("label").asText(),22)+"：关联登记值已核对";
  String summary="「"+shortLabel(results.get(0).path("label").asText(),24)+"」合计 "+results.get(0).path("total").asText()+" "+shortLabel(results.get(0).path("unit").asText(),12)+"；「"+shortLabel(results.get(1).path("label").asText(),24)+"」合计 "+results.get(1).path("total").asText()+" "+shortLabel(results.get(1).path("unit").asText(),12)+"。";
  if(summary.length()>240)summary="本次已核验 "+results.size()+" 项关联登记指标，完整精确值与来源范围见正文及关联结果表。";
  return new BriefingContentService.Request(request.calculationArtifactId(),title,summary,List.copyOf(paragraphs),request.businessType(),request.presentation());
 }
 private static String shortLabel(String value,int max){return value.length()<=max?value:value.substring(0,max)+"…";}
 private FusionNarrativeEvidence(){}
}
