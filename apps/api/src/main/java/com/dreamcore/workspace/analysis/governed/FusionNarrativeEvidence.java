package com.dreamcore.workspace.analysis.governed;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import com.dreamcore.workspace.identity.IdentityException;
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
 private FusionNarrativeEvidence(){}
}
