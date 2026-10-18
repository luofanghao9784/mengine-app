package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.CalculationConditions;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class CalculationConditionsTest {
 @Test void conditionalRuleDoesNotPermitUnfilteredDifferentCurrencyOrUngovernedRequests(){
  var j=new JsonMapper();var meta=j.readTree("""
   {"dictionary":{"fields":[{"name":"amount_cents","unit":"人民币分"}]},"analysisPolicy":{"noSumFields":["amount_cents"],"conditionalSums":[{"field":"amount_cents","equalsFilters":{"status":"SUCCESS","currency":"CNY"},"conversion":"CENTS_TO_YUAN"}]}}
   """);var filters=Map.of("status","SUCCESS","currency","CNY");
  assertDoesNotThrow(()->CalculationConditions.source(meta,"amount_cents",filters,"CENTS_TO_YUAN",true));
  for(var bad:List.of(Map.<String,String>of(),Map.of("status","SUCCESS"),Map.of("status","SUCCESS","currency","USD")))assertThrows(IdentityException.class,()->CalculationConditions.source(meta,"amount_cents",bad,"CENTS_TO_YUAN",true));
  assertThrows(IdentityException.class,()->CalculationConditions.source(meta,"amount_cents",filters,"NONE",true));
  assertThrows(IdentityException.class,()->CalculationConditions.source(meta,"amount_cents",filters,"CENTS_TO_YUAN",false));
  assertThrows(IdentityException.class,()->CalculationConditions.source(j.readTree("{}"),"amount_cents",filters,"CENTS_TO_YUAN",true));
  assertEquals("0.01",CalculationConditions.convert(new BigDecimal("1"),"CENTS_TO_YUAN").toPlainString());
 }
}
