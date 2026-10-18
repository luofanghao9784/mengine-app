package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.math.BigDecimal;
import java.util.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Bounded exact string predicates and one lossless monetary conversion; never SQL. */
public final class CalculationConditions {
 private static final JsonMapper JSON=new JsonMapper();
 private CalculationConditions(){}
 public static void validate(Map<String,String> filters,String conversion,Collection<String> columns){
  if(filters!=null&&(filters.size()>5||filters.entrySet().stream().anyMatch(e->!columns.contains(e.getKey())||e.getValue()==null||e.getValue().isBlank()||e.getValue().length()>160||e.getValue().codePoints().anyMatch(Character::isISOControl))))throw new IdentityException(422,"METRIC_FILTER_INVALID");
  if(conversion!=null&&!Set.of("NONE","CENTS_TO_YUAN").contains(conversion))throw new IdentityException(422,"METRIC_CONVERSION_INVALID");
 }
 public static boolean matches(JsonNode row,List<String> columns,Map<String,String> filters){
  if(filters==null)return true;
  for(var e:filters.entrySet()){var value=row.get(columns.indexOf(e.getKey()));if(!value.isString()||!value.asString().equals(e.getValue()))return false;}return true;
 }
 public static BigDecimal convert(BigDecimal value,String conversion){return "CENTS_TO_YUAN".equals(conversion)?value.movePointLeft(2):value;}
 public static void source(JsonNode meta,String field,Map<String,String> filters,String conversion,boolean governed){
  var policy=meta.path("analysisPolicy");boolean forbidden=false;
  for(var f:policy.path("noSumFields"))if(f.asText().equals(field))forbidden=true;
  if(forbidden){
   boolean allowed=false;
   if(governed&&filters!=null&&!filters.isEmpty())for(var rule:policy.path("conditionalSums")){
    if(field.equals(rule.path("field").asText())&&JSON.valueToTree(filters).equals(rule.path("equalsFilters"))&&Objects.equals(conversion==null?"NONE":conversion,rule.path("conversion").asText("NONE")))allowed=true;
   }
   if(!allowed)throw new IdentityException(422,"DATASET_NON_ADDITIVE_FIELD");
  }
  if("CENTS_TO_YUAN".equals(conversion)){
   boolean cents=false;for(var f:meta.path("dictionary").path("fields"))if(field.equals(f.path("name").asText())&&Set.of("分","人民币分").contains(f.path("unit").asText()))cents=true;
   if(!cents)throw new IdentityException(422,"METRIC_CONVERSION_SOURCE_UNIT_INVALID");
  }
 }
}
