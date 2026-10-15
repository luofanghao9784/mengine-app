package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.MetricAutomaticDefinition;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class MetricAutomaticDefinitionTest {
 final JsonMapper json=new JsonMapper();
 @Test void countIsExplicitlyRowsNotPeople(){var r=MetricAutomaticDefinition.decide(json.readTree("{\"aggregation\":\"COUNT\",\"valueField\":\"\"}"),json.readTree("{\"title\":\"合成会员\"}"),json.readTree("[\"id\"]"),json.readTree("[[\"a\"],[\"a\"]]"));assertNull(r.reason());assertTrue(r.definition().get("meaning").toString().contains("不去重"));}
 @Test void forbiddenSumNeverBecomesPublishedDespiteValidNumbers(){var r=MetricAutomaticDefinition.decide(json.readTree("{\"aggregation\":\"SUM\",\"valueField\":\"rate\",\"unit\":\"分\"}"),json.readTree("{\"analysisPolicy\":{\"noSumFields\":[\"rate\"]}}"),json.readTree("[\"rate\"]"),json.readTree("[[10],[20]]"));assertEquals("SOURCE_FORBIDS_SUM",r.reason());}
 @Test void emptySnapshotsWaitForData(){var r=MetricAutomaticDefinition.decide(json.readTree("{\"aggregation\":\"COUNT\",\"valueField\":\"\"}"),json.readTree("{}"),json.readTree("[\"id\"]"),json.readTree("[]"));assertEquals("EMPTY_SNAPSHOT",r.reason());}
 @Test void missingValueCannotSilentlyBecomeZero(){var r=MetricAutomaticDefinition.decide(json.readTree("{\"aggregation\":\"SUM\",\"valueField\":\"amount\",\"unit\":\"分\"}"),json.readTree("{}"),json.readTree("[\"amount\"]"),json.readTree("[[null]]"));assertEquals("INVALID_NUMERIC_VALUES",r.reason());}
}
