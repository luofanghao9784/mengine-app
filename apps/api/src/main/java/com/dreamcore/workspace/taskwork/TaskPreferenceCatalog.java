package com.dreamcore.workspace.taskwork;
import java.util.*;
/** Deliberately finite expression settings. No facts, identity, duties, budgets or authority can be encoded. */
public final class TaskPreferenceCatalog {
 public record Choice(String category,String choice,String label,List<String> explicitPhrases) {}
 public static final List<Choice> CHOICES=List.of(
  new Choice("BRIEFING_ORDER","CONCLUSION_FIRST","画报先给结论",List.of("请记住，以后我的画报先给结论")),
  new Choice("BRIEFING_ORDER","EVIDENCE_FIRST","画报先列依据",List.of("请记住，以后我的画报先列依据")),
  new Choice("RESPONSE_LENGTH","CONCISE","回答默认简洁",List.of("请记住，以后回答简洁一些","以后请默认简洁回答","Remember that I prefer concise responses")),
  new Choice("RESPONSE_LENGTH","DETAILED","回答默认详细",List.of("请记住，以后回答详细一些","以后请默认详细回答","Remember that I prefer detailed responses")),
  new Choice("RESPONSE_FORMAT","PARAGRAPHS","回答默认使用自然段",List.of("请记住，以后回答默认使用自然段","以后请默认用自然段回答","Remember that I prefer paragraph responses")),
  new Choice("RESPONSE_FORMAT","BULLETS","回答默认使用要点列表",List.of("请记住，以后回答默认使用要点列表","以后请默认用要点列表回答","Remember that I prefer bullet point responses")),
  new Choice("TONE","DIRECT","回答语气默认直接",List.of("请记住，以后回答语气直接一些","以后请默认用直接的语气回答","Remember that I prefer a direct tone")),
  new Choice("TONE","FRIENDLY","回答语气默认友好",List.of("请记住，以后回答语气友好一些","以后请默认用友好的语气回答","Remember that I prefer a friendly tone")));
 public static Choice find(String category,String choice){return CHOICES.stream().filter(c->c.category().equals(category)&&c.choice().equals(choice)).findFirst().orElse(null);}
 private static String normalized(String text){return text.strip().replaceAll("[，,。.!！\\s]","").toLowerCase(Locale.ROOT);}
 public static boolean explicit(Choice c,String evidence){return c!=null&&evidence!=null&&c.explicitPhrases().stream().anyMatch(p->normalized(p).equals(normalized(evidence)));}
 private TaskPreferenceCatalog(){}
}
