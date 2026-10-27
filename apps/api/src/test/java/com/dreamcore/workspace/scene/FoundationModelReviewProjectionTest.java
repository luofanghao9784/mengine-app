package com.dreamcore.workspace.scene;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

class FoundationModelReviewProjectionTest {
   private final JsonMapper json = new JsonMapper();

   @Test void currentModelReviewIsRequiredEvenWhenPublishedProgramChecksPass() {
      ObjectNode asset = published(true);
      FoundationModelReviewProjection.apply(asset, false);
      assertFalse(asset.path("available").asBoolean());
      assertFalse(asset.path("automaticAnalysisReady").asBoolean());
      assertFalse(asset.path("checksPassed").asBoolean());
      assertTrue(asset.path("deterministicChecksPassed").asBoolean());
      assertFalse(asset.path("modelChecksPassed").asBoolean());
      assertEquals("WAITING", asset.path("stageStates").path(3).asText());
      assertEquals("WAITING", asset.path("stageStates").path(4).asText());
      assertTrue(asset.path("label").asText().contains("模型"));
      assertTrue(asset.path("nativeGovernance").path("message").asText().contains("模型"));
   }

   @Test void bothChecksPassAndKeepActualAvailability() {
      ObjectNode asset = published(true);
      FoundationModelReviewProjection.apply(asset, true);
      assertTrue(asset.path("available").asBoolean());
      assertTrue(asset.path("automaticAnalysisReady").asBoolean());
      assertTrue(asset.path("checksPassed").asBoolean());
      assertTrue(asset.path("deterministicChecksPassed").asBoolean());
      assertTrue(asset.path("modelChecksPassed").asBoolean());
      assertEquals("READY", asset.path("stageStates").path(4).asText());
      assertTrue(asset.path("quality").isNull());
   }

   @Test void modelPassCannotPromotePublishedHardRuleFailure() {
      ObjectNode asset = published(false);
      FoundationModelReviewProjection.apply(asset, true);
      assertFalse(asset.path("available").asBoolean());
      assertFalse(asset.path("automaticAnalysisReady").asBoolean());
      assertFalse(asset.path("checksPassed").asBoolean());
      assertFalse(asset.path("deterministicChecksPassed").asBoolean());
      assertTrue(asset.path("modelChecksPassed").asBoolean());
      assertEquals("ATTENTION", asset.path("stageStates").path(3).asText());
      assertEquals("WAITING", asset.path("stageStates").path(4).asText());
      assertEquals("来源主键重复", asset.path("issues").path(0).asText());
   }

   @Test void projectionIsIdempotentAndDetailStageOverrideCannotUndoModelGate() {
      ObjectNode asset = published(true);
      FoundationModelReviewProjection.apply(asset, false);
      ObjectNode expected = asset.deepCopy();
      FoundationModelReviewProjection.apply(asset, false);
      assertEquals(expected, asset);
      asset.set("stageStates", json.valueToTree(java.util.List.of("READY", "READY", "READY", "READY", "READY")));
      FoundationModelReviewProjection.apply(asset, false);
      assertEquals(expected, asset);
   }

   @Test void deliveryHoldReasonAndStagesTakePrecedenceOverModelReview() {
      ObjectNode asset = published(true);
      asset.put("available", false).put("checksPassed", false).put("automaticAnalysisReady", false);
      asset.put("deterministicChecksPassed", true);
      asset.put("label", "等待来源交付").put("status", "waiting-source").put("gate", 2).put("needsAttention", false);
      asset.putObject("sourceDelivery").put("state", "SOURCE_COLLECTION_PENDING").put("message", "等待来源交付");
      asset.set("stageStates", json.valueToTree(java.util.List.of("READY", "READY", "WAITING_SOURCE", "WAITING_SOURCE", "WAITING")));
      var stages = asset.path("stageStates").deepCopy();
      FoundationModelReviewProjection.apply(asset, true);
      assertFalse(asset.path("available").asBoolean());
      assertFalse(asset.path("checksPassed").asBoolean());
      assertTrue(asset.path("deterministicChecksPassed").asBoolean());
      assertEquals("等待来源交付", asset.path("label").asText());
      assertEquals("waiting-source", asset.path("status").asText());
      assertEquals(stages, asset.path("stageStates"));
   }

   @Test void incompleteParseWaitsForParseBeforeModel() {
      ObjectNode asset = published(true);
      ((tools.jackson.databind.node.ArrayNode)asset.path("stageStates")).set(1, json.valueToTree("PARTIAL"));
      FoundationModelReviewProjection.apply(asset, false);
      assertFalse(asset.path("available").asBoolean());
      assertEquals("WAITING_PARSE", asset.path("modelReviewState").asText());
      assertTrue(asset.path("label").asText().contains("解析"));
      assertEquals("WAITING", asset.path("stageStates").path(3).asText());
   }

   @Test void failedNativeStateUsesGenericPublicFailureWithoutPrivateDraftText() {
      ObjectNode asset = published(true);
      asset.putObject("nativeGovernance").put("state", "FAILED").put("message", "private draft text");
      FoundationModelReviewProjection.apply(asset, false);
      assertTrue(asset.path("needsAttention").asBoolean());
      assertEquals("FAILED", asset.path("modelReviewState").asText());
      assertEquals("FAILED", asset.path("stageStates").path(3).asText());
      assertFalse(asset.path("label").asText().contains("private"));
   }

   @Test void modelPassDoesNotPromoteUnpublishedOrOtherwiseUnavailableSource() {
      ObjectNode asset = published(true);
      asset.put("available", false).put("automaticAnalysisReady", false);
      ((tools.jackson.databind.node.ArrayNode)asset.path("stageStates")).set(4, json.valueToTree("WAITING"));
      FoundationModelReviewProjection.apply(asset, true);
      assertFalse(asset.path("available").asBoolean());
      assertFalse(asset.path("automaticAnalysisReady").asBoolean());
      assertEquals("WAITING", asset.path("stageStates").path(4).asText());
   }

   private ObjectNode published(boolean deterministicPass) {
      ObjectNode asset = json.createObjectNode();
      asset.put("id", "dataset-00000000-0000-0000-0000-000000000001");
      asset.put("available", true).put("automaticAnalysisReady", deterministicPass).put("checksPassed", deterministicPass);
      asset.put("gate", 4).put("needsAttention", !deterministicPass).put("label", "已发布治理知识");
      asset.set("stageStates", json.valueToTree(java.util.List.of("READY", "READY", "READY", deterministicPass ? "READY" : "ATTENTION", "READY")));
      asset.set("issues", json.valueToTree(deterministicPass ? java.util.List.of() : java.util.List.of("来源主键重复")));
      asset.putNull("quality");
      asset.putObject("nativeGovernance").put("state", "PUBLISHED").put("message", "字段口径已发布，当前快照检查通过");
      return asset;
   }
}
