package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import tools.jackson.databind.node.ObjectNode;

public final class GovernanceReferencePolicy {
   private GovernanceReferencePolicy() {
   }

   public static boolean dataset(Map<?, ?> var0) {
      return var0 != null && "DATASET".equals(var0.get("kind"));
   }

   public static Map<String, Object> output(Map<String, Object> var0, Map<?, ?> var1) {
      if (var0 != null && dataset(var1)) {
         LinkedHashMap var2 = new LinkedHashMap(var0);
         var2.put("knowledge", List.of());
         return var2;
      } else {
         return var0;
      }
   }

   public static Map<String, Object> view(Map<String, Object> var0) {
      if (dataset(var0) && var0.get("output") instanceof Map var1) {
         LinkedHashMap var4 = new LinkedHashMap(var0);
         LinkedHashMap var3 = new LinkedHashMap(var1);
         var3.put("knowledge", List.of());
         var4.put("output", var3);
         return var4;
      } else {
         return var0;
      }
   }

   public static void validateEmptyKnowledge(Map<?, ?> var0) {
      if (var0 == null || !(var0.get("knowledge") instanceof List var1 && var1.isEmpty())) {
         throw new IdentityException(422, "GOVERNANCE_REFERENCE_KNOWLEDGE_DISABLED");
      }
   }

   public static String prompt(String var0, String var1) {
      if (!"DATASET".equals(var1)) {
         return var0;
      }

      int var2 = var0.indexOf(" 本轮执行统一治理与知识生成。");
      return (var2 < 0 ? var0 : var0.substring(0, var2))
         + " 本轮仅执行结构化数据治理。保留title、summary、limitations、fields、evidence；knowledge必须为空数组[]，不得生成数据治理参考知识、知识文章或私人知识草稿。此前preparationDraft仅作为待复核的来源补证，不视为已核实的业务事实。";
   }

   public static List<?> referenceCards(Object var0, UUID var1, UUID var2) {
      return List.of();
   }

   public static void validateRetiredText(Object var0, String var1, int var2) {
      if (var1 == null || !var1.isEmpty()) {
         throw new IdentityException(422, "GOVERNANCE_REFERENCE_KNOWLEDGE_DISABLED");
      }
   }

   public static boolean hasPublication(int var0, Map<?, ?> var1) {
      return dataset(var1) || var0 > 0;
   }

   public static int knowledgeCount(int var0, String var1) {
      return "DATASET".equals(var1) ? 0 : var0;
   }

   public static String scope(String var0, String var1) {
      return "DATASET".equals(var1) ? "字段口径与治理回执已生效；未知项和原始记录质量仍按检查结果使用" : var0;
   }

   public static String publicationLabel(String var0, String var1) {
      return "DATASET".equals(var1) ? "治理结果发布" : var0;
   }

   public static void applyPublication(ObjectNode var0) {
      if ("table".equals(var0.path("kind").asText())) {
         var0.put("availabilityKind", "PUBLISHED_GOVERNANCE");
         var0.put("availableKnowledgeCount", 0);
         var0.put("label", var0.path("label").asText().replace("已发布治理知识", "治理结果已生效"));
      }
   }
}
