package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.time.LocalDate;
import java.util.*;

/** Versioned bounded business recipe shared by external authors and provider tools. Not an access grant. */
public final class BriefingBusinessPlan {
 public record Request(String question,String goal,String recipe,List<String> storeIds,String dateFrom,String dateTo) {}
 public record Plan(String version,String question,String goal,String recipe,List<String> storeIds,String dateFrom,String dateTo,List<String> metrics,String chartStyle,int cards,String size) {}
 public static Plan resolve(Request r){
  if(r==null||r.question()==null||r.question().isBlank()||r.question().length()>500||r.goal()==null||r.goal().isBlank()||r.goal().length()>500||!"MONTHLY_SALES_RECEIPTS".equals(r.recipe())||r.storeIds()==null||r.storeIds().size()<2||r.storeIds().size()>10||new HashSet<>(r.storeIds()).size()!=r.storeIds().size()||r.storeIds().stream().anyMatch(s->s==null||!s.matches("[a-zA-Z0-9_-]{1,80}")))throw IdentityException.invalid();
  try{var from=LocalDate.parse(r.dateFrom());var to=LocalDate.parse(r.dateTo());if(to.isBefore(from)||from.getYear()!=to.getYear()||from.getMonth()!=to.getMonth())throw new IllegalArgumentException();}catch(RuntimeException e){throw new IdentityException(422,"BRIEFING_PLAN_PERIOD_INVALID");}
  return new Plan("business-plan-v1",r.question().strip(),r.goal().strip(),r.recipe(),r.storeIds().stream().sorted().toList(),r.dateFrom(),r.dateTo(),List.of("orderSalesByConfirmationDate","businessConfirmed"),"GROUPED_BAR",1,"2x2");
 }
 private BriefingBusinessPlan(){}
}
