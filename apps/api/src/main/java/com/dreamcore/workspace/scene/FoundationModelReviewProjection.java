package com.dreamcore.workspace.scene;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Public readiness overlay; never reads model output or promotes the underlying source. */
final class FoundationModelReviewProjection {
   private static final JsonMapper JSON = new JsonMapper();

   private FoundationModelReviewProjection() {}

   static void apply(ObjectNode asset, boolean modelReady) {
      // Keep the program result across repeated application, including detail's stage replacement.
      boolean deterministic = asset.has("deterministicChecksPassed")
          ? asset.path("deterministicChecksPassed").asBoolean() : asset.path("checksPassed").asBoolean();
      asset.put("deterministicChecksPassed", deterministic);
      asset.put("modelChecksPassed", modelReady);
      boolean parsed = "READY".equals(asset.path("stageStates").path(1).asText());
      boolean failed = !modelReady && "FAILED".equals(asset.path("nativeGovernance").path("state").asText());
      asset.put("modelReviewState", !parsed ? "WAITING_PARSE" : modelReady ? "READY" : failed ? "FAILED" : "WAITING");

      // The delivery hold already carries its public reason and exact processing stages.
      if (asset.has("sourceDelivery")) {
         asset.put("available", false).put("automaticAnalysisReady", false).put("checksPassed", false);
         return;
      }

      boolean checksPassed = parsed && deterministic && modelReady;
      asset.put("checksPassed", checksPassed);
      ArrayNode stages = asset.path("stageStates").isArray()
          ? ((ArrayNode)asset.path("stageStates")).deepCopy() : JSON.createArrayNode();
      while (stages.size() < 5) stages.add("WAITING");
      boolean underlyingReady = true;
      for (int i = 0; i < 4; i++) underlyingReady &= "READY".equals(stages.path(i).asText());
      boolean available = checksPassed && underlyingReady && asset.path("available").asBoolean();
      asset.put("available", available);
      asset.put("automaticAnalysisReady", available && asset.path("automaticAnalysisReady").asBoolean());
      if (!checksPassed) {
         String state = !parsed ? "WAITING" : !deterministic
             ? ("READY".equals(stages.path(3).asText()) ? "ATTENTION" : stages.path(3).asText())
             : failed ? "FAILED" : "WAITING";
         stages.set(3, JSON.valueToTree(state));
         asset.put("gate", Math.min(asset.path("gate").asInt(), 3));
         if (!parsed) asset.put("label", "等待完整解析后进行模型审阅");
         else if (!deterministic) asset.put("label", "程序检查尚未完成或未通过；AI 可用状态等待处理");
         else asset.put("label", failed ? "当前模型审阅未通过；请处理后重新审阅" : "等待当前版本模型审阅通过");
         if (asset.path("nativeGovernance").isObject())
            ((ObjectNode)asset.path("nativeGovernance")).put("message", asset.path("label").asText());
         asset.put("needsAttention", asset.path("needsAttention").asBoolean() || failed || (!deterministic && "ATTENTION".equals(state)));
      }
      if (!available) stages.set(4, JSON.valueToTree("WAITING"));
      asset.set("stageStates", stages);
   }
}
